//! The plugin's window (PLUGIN-3.2): the app's device rack (`src/plugin/` in the app) in a webview,
//! wry's, attached straight to the view the host gives the plugin (PLUGIN-2.2's spike, on nice-plug's
//! editor API).
//!
//! - **The page** is the app's built `dist/`, built into the binary (build.rs, PLUGIN-3.3) and served
//!   over a `corrente://` scheme, or the Vite dev server's when the plugin is built with
//!   `CORRENTE_DEV_URL` (`http://localhost:5180/plugin.html`), for fast iteration. Updating it like
//!   the site is HOST-23.2.3's.
//! - **Page to plugin**, as JSON through wry's IPC handler, on the main thread:
//!   - `ready`: the page asks for its saved state, and gets it back through `window.corrente.restore`.
//!   - `load`: a device package (src/audio/bank/devicePackage.ts) on every change. The same device
//!     with values moved sets just those; another is built and swapped in (params.rs).
//!   - `preview`: a sound Explore tries, played in place of the package and not saved; null ends it.
//!   - `value`: one of the binding's values moved (a knob), set between blocks without a rebuild.
//!   - `rack`: the page's project snapshot, saved with the host's project.
//!   - `macros`: what each macro is mapped to, by the param's binding name (PLUGIN-3.4).
//!   - `keys`: hand the keyboard back to the host (after a click that wasn't into a text field).
//!   - `log`: a line for the plugin's log.
//! - **A value a macro is mapped to moves the macro too**, as a drag the host hears (begin, set, end),
//!   so the host's control and the page's knob agree, and the host can record it. The other way, a
//!   macro the host moves (a knob, automation) moves the page's knob: `window.corrente.macro`.
//! - **The plugin calls the page** with `window.corrente.restore(rack, macros)` when it's ready, and
//!   `window.corrente.macro(name, position)` when the host moves a mapped macro.
//!
//! Rust notes, for reading this file:
//! - `Rc<RefCell<T>>` is shared ownership on one thread (`Rc`) of something borrowed writable on
//!   demand (`RefCell`). The webview lives in one so the IPC handler, made before it, can reach it.
//! - `unsafe impl Send` promises Rust a value may cross threads. A webview may not; the promise holds
//!   because nice-plug keeps the editor's handle on the main thread, where it was made.
//! - `#[cfg(target_os = "macos")]` compiles what follows on macOS only.

use crate::params::{Macros, Slots};
use nice_plug::context::gui::GuiContext;
use nice_plug::editor::dpi::NativeSize;
use nice_plug::editor::{EditorHandle, HostMethods, SpawnedEditor};
use nice_plug::prelude::*;
use serde::Deserialize;
use std::borrow::Cow;
use std::cell::RefCell;
use std::error::Error;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::http::{Request, Response};
use wry::{Rect, WebView, WebViewBuilder};

/// Where the page is: the dev server's, if the plugin was built with one, else the app's own files.
// TS: const PAGE = process.env.CORRENTE_DEV_URL ?? "corrente://localhost/plugin.html";
// `option_env!` reads an environment variable when the plugin is compiled, not when it runs.
const PAGE: &str = match option_env!("CORRENTE_DEV_URL") {
    Some(url) => url,
    None => "corrente://localhost/plugin.html",
};

/// Run in every page before its own scripts: its errors go to the plugin's log, so a run in a DAW,
/// with no devtools open, still says what went wrong.
const REPORTER: &str = r#"(() => {
  const log = (text) => window.ipc.postMessage(JSON.stringify({ type: "log", text }));
  addEventListener("error", (event) => log(`error: ${event.message} (${event.filename}:${event.lineno})`));
  addEventListener("unhandledrejection", (event) => log(`unhandled rejection: ${event.reason}`));
})();"#;

/// The window's size before the host or the page changes it, in logical pixels.
const WIDTH: u32 = 960;
const HEIGHT: u32 = 560;

// TS: type Message = { type: "ready" } | { type: "load"; package: string } | ...
// `#[serde(tag = "type")]` reads which case it is from the `type` field, as the page writes it.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Message {
    Ready,
    Load { package: String },
    Preview { package: Option<String> },
    Value { value: usize, raw: f64 },
    Rack { rack: String },
    Macros { slots: Slots },
    Keys,
    Log { text: String },
}

/// The editor nice-plug asks for: what a window needs, kept between openings.
pub struct RackEditor {
    params: Arc<Macros>,
    /// The window's size in logical pixels; the host can change it.
    width: Arc<AtomicU32>,
    height: Arc<AtomicU32>,
}

impl RackEditor {
    pub fn new(params: Arc<Macros>) -> Self {
        Self { params, width: Arc::new(AtomicU32::new(WIDTH)), height: Arc::new(AtomicU32::new(HEIGHT)) }
    }
}

/// Builds the webview into a parent view: made when the editor opens, run once there is a parent.
type Build = Box<dyn FnOnce(&ParentWindowHandle) -> wry::Result<WebView>>;

/// An open window: dropping it (the host closing the editor) removes the webview.
pub struct RackWindow {
    webview: Rc<RefCell<Option<WebView>>>,
    /// The build, until the host hands over a parent (CLAP does after opening; VST3 when opening).
    build: RefCell<Option<Build>>,
    width: Arc<AtomicU32>,
    height: Arc<AtomicU32>,
    /// What the macros are mapped to, to tell the page which knob a host's macro moves.
    params: Arc<Macros>,
}
unsafe impl Send for RackWindow {}

impl RackWindow {
    /// Build the webview into `parent`, the first time there is one.
    // TS: const build = this.build; this.build = undefined; if (build) buildInWindow(parent, this.webview, build);
    fn attach(&self, parent: ParentWindowHandle) {
        if let Some(build) = self.build.borrow_mut().take() {
            build_in_window(parent, Rc::downgrade(&self.webview), build, 0);
        }
    }

    /// The webview's bounds: the whole of the window, at its size now.
    fn bounds(&self) -> Rect {
        bounds(self.width.load(Ordering::Relaxed), self.height.load(Ordering::Relaxed))
    }
}

// TS: return { position: { x: 0, y: 0 }, size: { width, height } }
fn bounds(width: u32, height: u32) -> Rect {
    Rect { position: LogicalPosition::new(0, 0).into(), size: LogicalSize::new(width, height).into() }
}

/**
 * Build the webview into `slot` once the host's view is in a window: wry needs the window (for its
 * scale factor) and panics without one. Hosts mostly attach the view before opening the editor, but
 * not all, so until it is, try again on the main thread's next turn, unless the editor has closed
 * meanwhile (the slot is gone).
 */
#[cfg(target_os = "macos")]
fn build_in_window(parent: ParentWindowHandle, slot: Weak<RefCell<Option<WebView>>>, build: Build, turns: u32) {
    use dispatch2::DispatchQueue;
    use objc2_app_kit::NSView;

    /// Carries main-thread values through dispatch, whose work must be `Send`. Sound because it's
    /// only ever sent to the main queue, the thread it came from.
    struct MainThread<T>(T);
    unsafe impl<T> Send for MainThread<T> {}
    impl<T> MainThread<T> {
        // A method rather than a pattern, so the closure takes the whole wrapper (which is Send),
        // not the fields inside (which aren't).
        fn into_inner(self) -> T {
            self.0
        }
    }

    // TS: const webview = slot.deref(); if (!webview) return;
    let Some(webview) = slot.upgrade() else { return };
    let ParentWindowHandle::AppKitNsView(view) = parent else { return };
    // Safe because the host keeps its view alive while the editor is open, which `slot` shows it is.
    let in_window = unsafe { view.cast::<NSView>().as_ref() }.window().is_some();
    // TS: if (!inWindow) { queueMicrotask(() => buildInWindow(parent, slot, build, turns + 1)); return; }
    if !in_window {
        let carried = MainThread((parent, slot, build));
        DispatchQueue::main().exec_async(move || {
            let (parent, slot, build) = carried.into_inner();
            build_in_window(parent, slot, build, turns + 1);
        });
        return;
    }
    // TS: try { webview.value = build(parent) } catch (error) { log(error) }
    match build(&parent) {
        Ok(built) => *webview.borrow_mut() = Some(built),
        Err(error) => nice_error!("the window's webview didn't open: {error}"),
    }
    if turns > 0 {
        nice_log!("the host's view was in a window {turns} turns after the editor opened");
    }
}

/// Elsewhere, the host's window is there when it's handed over.
#[cfg(not(target_os = "macos"))]
fn build_in_window(parent: ParentWindowHandle, slot: Weak<RefCell<Option<WebView>>>, build: Build, _turns: u32) {
    let Some(webview) = slot.upgrade() else { return };
    match build(&parent) {
        Ok(built) => *webview.borrow_mut() = Some(built),
        Err(error) => nice_error!("the window's webview didn't open: {error}"),
    }
}

/**
 * Give the keyboard back to the host. A host plays notes from the computer's keyboard (Ableton's
 * computer MIDI keyboard), and while the webview has it, a key goes to the page first and only then,
 * late or not at all, to the host: notes held too long, quick presses lost. So after a click the page
 * asks for this, and the host's own view, the one the webview sits in, takes the keyboard again.
 */
#[cfg(target_os = "macos")]
fn keys_to_host(webview: &WebView) {
    use wry::WebViewExtMacOS;
    // TS: const host = webview.view.superview; host?.window?.makeFirstResponder(host) || host?.window?.makeFirstResponder(null);
    // A view that won't take it leaves the window itself to (`None`), which passes keys on to the host.
    // `superview` is `unsafe` in the bindings, which can't know the parent outlives the call; the host
    // keeps it while the window is open, and this runs only then.
    let view = webview.webview();
    let Some(host) = (unsafe { view.superview() }) else { return };
    let Some(window) = host.window() else { return };
    if !window.makeFirstResponder(Some(&host)) {
        window.makeFirstResponder(None);
    }
}

/// Elsewhere, the keyboard isn't the webview's to hand back yet.
#[cfg(not(target_os = "macos"))]
fn keys_to_host(_webview: &WebView) {}

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
        "wav" => "audio/wav",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
    Response::builder().header("Content-Type", content_type).body(body).unwrap()
}

/// The app's built files (build.rs).
pub(crate) mod app {
    include!(concat!(env!("OUT_DIR"), "/app.rs"));
}

/// The `corrente://` scheme: a file of the app's `dist/`, or a page saying the app wasn't built in.
pub(crate) fn serve(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    // TS: if (app.FILES.length === 0) return page("Built without the app ...");
    if app::FILES.is_empty() {
        let page = "<p style=\"font-family: sans-serif\">Built without the app: run `yarn build` in packages/app before building the plugin, or use `yarn plugin:bundle`.</p>";
        return respond(Cow::Borrowed(page.as_bytes()), "missing.html");
    }
    // TS: const file = app.FILES.find(([path]) => path === request.path.replace(/^\//, "")); return file ? respond(file[1]) : notFound;
    let path = request.uri().path().trim_start_matches('/');
    match app::FILES.iter().find(|(name, _)| *name == path) {
        Some((_, bytes)) => respond(Cow::Borrowed(bytes), path),
        None => Response::builder().status(404).body(Cow::Borrowed(&b"Not found"[..])).unwrap(),
    }
}

/// Move the macro mapped to value `index` (if one is) to where `raw` sits, as a drag the host hears.
// TS: const mapped = params.macroFor(index, raw); if (mapped) { setter.begin(knob); setter.setNormalized(knob, position); setter.end(knob); }
fn move_macro(params: &Macros, context: &GuiContext, index: usize, raw: f64) {
    let Some((knob, position)) = params.macro_for(index, raw) else { return };
    let (setter, param) = (context.param_setter(), &params.knobs[knob]);
    setter.begin_set_parameter(param);
    setter.set_parameter_normalized(param, position as f32);
    setter.end_set_parameter(param);
}

impl Editor for RackEditor {
    type Handle = RackWindow;

    fn spawn(
        &self,
        parent: Option<ParentWindowHandle>,
        _wait_for_parent: bool,
        _fallback_scale_factor: Option<f64>,
        context: GuiContext,
        _host: Option<HostMethods>,
    ) -> Result<SpawnedEditor<RackWindow>, Box<dyn Error>> {
        let webview: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(None));
        let (params, reply_to, keys_to) = (self.params.clone(), Rc::downgrade(&webview), Rc::downgrade(&webview));
        // TS: const reply = (script: string) => webview.deref()?.value?.evaluateScript(script);
        let reply = move |script: String| {
            if let Some(view) = reply_to.upgrade().as_ref().and_then(|view| view.borrow().as_ref().map(|view| view.evaluate_script(&script))) {
                if let Err(error) = view {
                    nice_error!("the window didn't take the plugin's reply: {error}");
                }
            }
        };
        // TS: const handle = (request) => { const message = JSON.parse(request.body); switch on message.type (the `match` below) }
        let handle_message = move |request: Request<String>| {
            let message = match serde_json::from_str::<Message>(request.body()) {
                Ok(message) => message,
                Err(error) => return nice_error!("the window sent a message the plugin can't read: {error}"),
            };
            match message {
                // TS: reply(`window.corrente?.restore(${JSON.stringify(params.rack || null)}, ${JSON.stringify(params.slots)})`)
                // The rack is JSON already, so it goes to the page as a string for it to parse.
                Message::Ready => {
                    let rack = params.rack.lock().map(|rack| rack.clone()).unwrap_or_default();
                    let argument = if rack.is_empty() { "null".to_owned() } else { serde_json::to_string(&rack).unwrap_or_default() };
                    reply(format!("window.corrente?.restore({argument}, {})", params.slots_json()));
                }
                // TS: const moved = params.load(package); if (!moved) log; else moved.forEach(([index, raw]) => moveMacro(index, raw));
                Message::Load { package } => match params.load(&package) {
                    Some(moved) => moved.into_iter().for_each(|(index, raw)| move_macro(&params, &context, index, raw)),
                    None => nice_error!("the window's device didn't load"),
                },
                // TS: if (!params.preview(package)) log;
                Message::Preview { package } => {
                    if !params.preview(package.as_deref()) {
                        nice_error!("the sound the window tried didn't load");
                    }
                }
                // TS: params.setValue(value, raw); moveMacro(value, raw);
                Message::Value { value, raw } => {
                    params.set_value(value, raw);
                    move_macro(&params, &context, value, raw);
                }
                // TS: params.rack = rack;
                Message::Rack { rack } => {
                    if let Ok(mut saved) = params.rack.lock() {
                        *saved = rack;
                    }
                }
                // TS: params.setMacros(slots).forEach(([index, raw]) => moveMacro(index, raw));
                Message::Macros { slots } => params.set_macros(slots).into_iter().for_each(|(index, raw)| move_macro(&params, &context, index, raw)),
                // TS: if (webview.deref()?.value) keysToHost(webview.deref().value);
                Message::Keys => {
                    if let Some(view) = keys_to.upgrade() {
                        if let Some(view) = view.borrow().as_ref() {
                            keys_to_host(view);
                        }
                    }
                }
                Message::Log { text } => nice_log!("window: {text}"),
            }
        };

        let first = bounds(self.width.load(Ordering::Relaxed), self.height.load(Ordering::Relaxed));
        // TS: const build = (parent) => new WebViewBuilder().withBounds(first).withCustomProtocol("corrente", serve)...buildAsChild(parent);
        let build: Build = Box::new(move |parent| {
            WebViewBuilder::new()
                .with_bounds(first)
                .with_custom_protocol("corrente".into(), |_id, request| serve(request))
                .with_url(PAGE)
                .with_initialization_script(REPORTER)
                .with_ipc_handler(handle_message)
                .with_accept_first_mouse(true)
                .with_devtools(true)
                .build_as_child(parent)
        });
        let window = RackWindow { webview, build: RefCell::new(Some(build)), width: self.width.clone(), height: self.height.clone(), params: self.params.clone() };
        // VST3 hands the parent over now; CLAP does it after, through `set_parent`.
        if let Some(parent) = parent {
            window.attach(parent);
        }
        Ok(SpawnedEditor { handle: window, window: () })
    }

    // TS: return { width: this.width, height: this.height }
    fn size(&self) -> NativeSize<u32> {
        NativeSize { width: self.width.load(Ordering::Relaxed), height: self.height.load(Ordering::Relaxed) }
    }

    // The rack wraps to any width, so the host may resize it freely.
    // TS: return { canResize: true, canResizeHorizontally: true, canResizeVertically: true, ...ResizeHint.default }
    fn resize_hint(&self) -> ResizeHint {
        ResizeHint { can_resize: true, can_resize_horizontally: true, can_resize_vertically: true, ..ResizeHint::default() }
    }
}

/// What went wrong with the window, for nice-plug's log.
#[derive(Debug)]
pub struct WindowError(String);
impl std::fmt::Display for WindowError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}
impl Error for WindowError {}

/// Do `act` to the webview, if it's built yet, with wry's error as ours.
// TS: try { if (window.webview) act(window.webview) } catch (error) { throw new WindowError(String(error)) }
// `.map_or(Ok(()), act)` gives Ok for no webview, else what `act` gives; `.map_err` changes the error.
fn on_webview(window: &RackWindow, act: impl FnOnce(&WebView) -> wry::Result<()>) -> Result<(), WindowError> {
    window.webview.borrow().as_ref().map_or(Ok(()), act).map_err(|error| WindowError(error.to_string()))
}

impl EditorHandle for RackWindow {
    // nice-plug's own window type, for editors that make one; the webview is ours, so nothing here.
    type Window = ();
    type Error = WindowError;

    // Only nice-plug's standalone program runs this, and the plugin isn't built as one.
    fn run_until_closed(_window: ()) -> Result<(), WindowError> {
        Err(WindowError("the rack window runs only in a host".to_owned()))
    }

    // TS: this.attach(parent)
    fn set_parent(&self, parent: ParentWindowHandle, _window: &()) -> Result<(), WindowError> {
        self.attach(parent);
        Ok(())
    }

    // TS: this.webview?.setVisible(true)
    fn show(&self, _window: &()) -> Result<(), WindowError> {
        on_webview(self, |webview| webview.set_visible(true))
    }

    // TS: this.webview?.setVisible(false)
    fn hide(&self, _window: &()) -> Result<(), WindowError> {
        on_webview(self, |webview| webview.set_visible(false))
    }

    // TS: this.width = size.width; this.height = size.height; this.webview?.setBounds(this.bounds());
    fn set_size(&self, size: NativeSize<u32>, _window: &()) -> Result<(), WindowError> {
        self.width.store(size.width, Ordering::Relaxed);
        self.height.store(size.height, Ordering::Relaxed);
        on_webview(self, |webview| webview.set_bounds(self.bounds()))
    }

    // Only X11 needs a call back on the main thread.
    fn host_main_thread_callback(&self, _window: &()) {}

    /// The host moved a macro (its knob, or automation): the page's knob it's mapped to follows. Runs on
    /// the main thread. The page leaves alone a knob already there, as one it moved itself is.
    // TS:
    //   const knob = Number(id.replace("macro", "")) - 1; const target = this.params.targets[knob];
    //   if (target) this.webview?.evaluateScript(`window.corrente?.macro(${JSON.stringify(target.name)}, ${position})`);
    fn param_value_changed(&self, id: &str, normalized_value: f32) {
        let Some(knob) = id.strip_prefix("macro").and_then(|number| number.parse::<usize>().ok()).and_then(|number| number.checked_sub(1)) else { return };
        let Some(name) = self.params.targets.read().ok().and_then(|targets| targets.get(knob).and_then(Option::as_ref).map(|target| target.name.clone())) else { return };
        let script = format!("window.corrente?.macro({}, {normalized_value})", serde_json::to_string(&name).unwrap_or_default());
        if let Err(error) = on_webview(self, |webview| webview.evaluate_script(&script)) {
            nice_error!("the window didn't take a macro's move: {error}");
        }
    }
    fn param_modulation_changed(&self, _id: &str, _modulation_offset: f32) {}
}
