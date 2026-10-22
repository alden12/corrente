//! The webview editor: wry's webview attached straight to the window the host gives the plugin.
//! No windowing layer between them (the community crates use baseview); the host's view is the
//! parent, and the webview fills it.
//!
//! - **Pages** come from the plugin over a `corrente://` scheme: the spike's page (`page.html`), and,
//!   when built with `CORRENTE_APP_DIR` set to the app's `dist/`, the app itself, to see whether it
//!   runs in a plugin's webview.
//! - **Page to plugin** messages arrive through wry's IPC handler, on the main thread, as JSON:
//!   `begin`, `set` (a normalised Gain) and `end` drive the host parameter as a drag; `resize` asks
//!   the host for a new size; `poll` asks for the state; `log` writes a line to the plugin's log.
//! - **Plugin to page:** the page polls (every 50 ms) and gets the state back through
//!   `evaluate_script`. Polling keeps the host's change notifications, which may come on the audio
//!   thread, down to nothing: the state is read from the params themselves.
//!
//! Rust notes, for reading this file:
//! - `Rc<RefCell<T>>` is shared ownership on one thread (`Rc`) of something borrowed writable on
//!   demand (`RefCell`). The webview lives in one so the IPC handler, made before it, can reach it.
//! - `unsafe impl Send` promises Rust a value may cross threads. A webview may not; the promise
//!   holds because nih-plug only drops the editor's handle on the main thread, where it was made.
//! - `AtomicU32` is a number threads can read and write without a lock.

use nih_plug::prelude::*;
use raw_window_handle::{AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle};
use std::borrow::Cow;
use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::http::{Request, Response};
use dispatch2::DispatchQueue;
use objc2_app_kit::NSView;
use wry::{Rect, WebView, WebViewBuilder};

const PAGE: &str = include_str!("page.html");
/// Run in every page the webview loads, the app's included: errors and what the page can use, sent
/// to the plugin's log, so a run with nobody watching still says what happened.
const REPORTER: &str = include_str!("reporter.js");

pub struct WebViewEditor {
    params: Arc<crate::SpikeParams>,
    /// The editor's size in logical pixels; the page can change it.
    width: Arc<AtomicU32>,
    height: Arc<AtomicU32>,
    /// How many times this instance's editor has been opened, shown on the page.
    opens: Arc<AtomicU32>,
}

impl WebViewEditor {
    pub fn new(params: Arc<crate::SpikeParams>) -> Self {
        Self {
            params,
            width: Arc::new(AtomicU32::new(640)),
            height: Arc::new(AtomicU32::new(420)),
            opens: Arc::new(AtomicU32::new(0)),
        }
    }
}

/// The host's view, as wry wants a parent: raw-window-handle 0.6's interface (nih-plug speaks 0.5).
struct HostView(NonNull<c_void>);

impl HasWindowHandle for HostView {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(self.0));
        // Safe because the host keeps its view alive while the editor is open.
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

/**
 * Carries main-thread values (the webview's slot, the closure that builds it) through dispatch, whose
 * work must be `Send`. Sound because it's only ever sent to the main queue, the thread it came from.
 */
struct MainThread<T>(T);
unsafe impl<T> Send for MainThread<T> {}
impl<T> MainThread<T> {
    // A method rather than a pattern, so a closure takes the whole wrapper (which is Send) and not
    // the field inside (which isn't).
    fn into_inner(self) -> T {
        self.0
    }
}

type Build = Box<dyn FnOnce(&HostView) -> wry::Result<WebView>>;

/**
 * Build the webview into `slot` once the host's view is in a window: wry needs the window (for its
 * scale factor) and panics without one. Hosts mostly attach the view before opening the editor;
 * nih-plug's standalone window doesn't. So, until it is, try again on the main thread's next turn,
 * unless the editor has closed meanwhile (the slot is gone).
 */
fn build_in_window(view: NonNull<c_void>, slot: Weak<RefCell<Option<WebView>>>, build: Build, turns: u32) {
    let Some(webview) = slot.upgrade() else { return };
    // Safe because the host keeps its view alive while the editor is open, which `slot` shows it is.
    let in_window = unsafe { view.cast::<NSView>().as_ref() }.window().is_some();
    if !in_window {
        let carried = MainThread((view, slot, build));
        DispatchQueue::main().exec_async(move || {
            let (view, slot, build) = carried.into_inner();
            build_in_window(view, slot, build, turns + 1);
        });
        return;
    }
    match build(&HostView(view)) {
        Ok(built) => *webview.borrow_mut() = Some(built),
        Err(error) => nih_error!("the webview didn't open: {error}"),
    }
    if turns > 0 {
        nih_log!("the host's view was in a window {turns} turns after the editor opened");
    }
}

/// What `spawn` hands back: dropping it (the host closing the editor) removes the webview.
struct Open {
    _webview: Rc<RefCell<Option<WebView>>>,
}
unsafe impl Send for Open {}

/// A file the scheme serves, with its type.
fn respond(body: Cow<'static, [u8]>, path: &str) -> Response<Cow<'static, [u8]>> {
    // TS: const TYPES = { html: "text/html", ... }; TYPES[extension] ?? "application/octet-stream"
    let content_type = match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "webmanifest" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
    Response::builder().header("Content-Type", content_type).body(body).unwrap()
}

/// The `corrente://` scheme: the spike's page, else a file of the app (index.html for a route).
fn serve(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().to_owned();
    if path == "/spike.html" {
        return respond(Cow::Borrowed(PAGE.as_bytes()), &path);
    }
    let Some(app) = option_env!("CORRENTE_APP_DIR") else {
        return Response::builder().status(404).body(Cow::Borrowed(&b"No app built in"[..])).unwrap();
    };
    let file = std::path::Path::new(app).join(path.trim_start_matches('/'));
    match std::fs::read(&file) {
        Ok(bytes) => respond(Cow::Owned(bytes), &path),
        Err(_) => respond(Cow::Owned(std::fs::read(std::path::Path::new(app).join("index.html")).unwrap_or_default()), "index.html"),
    }
}

impl Editor for WebViewEditor {
    fn spawn(&self, parent: ParentWindowHandle, context: Arc<dyn GuiContext>) -> Box<dyn std::any::Any + Send> {
        let ParentWindowHandle::AppKitNsView(view) = parent else {
            panic!("the spike only knows macOS");
        };
        let opens = self.opens.fetch_add(1, Ordering::Relaxed) + 1;
        let webview: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(None));

        let (params, width, height) = (self.params.clone(), self.width.clone(), self.height.clone());
        let reply_to = webview.clone();
        // An instance's identity for the page: where its params live.
        let instance = Arc::as_ptr(&self.params) as usize;
        let handle_message = move |request: Request<String>| {
            let Ok(message) = serde_json::from_str::<serde_json::Value>(request.body()) else { return };
            let setter = ParamSetter::new(&*context);
            let number = |key: &str| message[key].as_f64().unwrap_or(0.0);
            match message["type"].as_str() {
                Some("begin") => setter.begin_set_parameter(&params.gain),
                Some("set") => setter.set_parameter_normalized(&params.gain, number("value") as f32),
                Some("end") => setter.end_set_parameter(&params.gain),
                Some("resize") => {
                    width.store(number("width") as u32, Ordering::Relaxed);
                    height.store(number("height") as u32, Ordering::Relaxed);
                    let resized = context.request_resize();
                    if let Some(view) = reply_to.borrow().as_ref() {
                        let size = LogicalSize::new(width.load(Ordering::Relaxed), height.load(Ordering::Relaxed));
                        let _ = view.set_bounds(Rect { position: LogicalPosition::new(0, 0).into(), size: size.into() });
                        let _ = view.evaluate_script(&format!("window.onResized({resized})"));
                    }
                }
                // The page reporting on itself, for runs where nobody's watching it.
                Some("log") => nih_log!("page: {}", message["text"].as_str().unwrap_or("")),
                Some("poll") => {
                    let state = serde_json::json!({
                        "instance": format!("{instance:x}"),
                        "opens": opens,
                        "gain": params.gain.unmodulated_normalized_value(),
                        "text": params.gain.to_string(),
                    });
                    if let Some(view) = reply_to.borrow().as_ref() {
                        let _ = view.evaluate_script(&format!("window.onPlugin({state})"));
                    }
                }
                _ => {}
            }
        };

        let size = LogicalSize::new(self.width.load(Ordering::Relaxed), self.height.load(Ordering::Relaxed));
        let build: Build = Box::new(move |parent| {
            WebViewBuilder::new()
                .with_bounds(Rect { position: LogicalPosition::new(0, 0).into(), size: size.into() })
                .with_custom_protocol("corrente".into(), |_id, request| serve(request))
                .with_url(if std::env::var_os("SPIKE_SELFTEST").is_some() {
                    "corrente://localhost/spike.html?selftest"
                } else {
                    "corrente://localhost/spike.html"
                })
                .with_initialization_script(REPORTER)
                .with_ipc_handler(handle_message)
                .with_accept_first_mouse(true)
                .with_devtools(true)
                .build_as_child(parent)
        });
        build_in_window(NonNull::new(view).expect("the host's view"), Rc::downgrade(&webview), build, 0);
        Box::new(Open { _webview: webview })
    }

    fn size(&self) -> (u32, u32) {
        (self.width.load(Ordering::Relaxed), self.height.load(Ordering::Relaxed))
    }

    fn set_scale_factor(&self, _factor: f32) -> bool {
        // macOS scales for us (the sizes are logical pixels).
        false
    }

    // The page polls for the state, so there's nothing to do when the host changes a param.
    fn param_value_changed(&self, _id: &str, _normalized_value: f32) {}
    fn param_modulation_changed(&self, _id: &str, _modulation_offset: f32) {}
    fn param_values_changed(&self) {}
}
