//! The window's page updates itself (HOST-23.2.3.1): newer builds of the app's page come from
//! corrente.cloud, as the site's do, while the plugin binary stays as it is.
//!
//! - **Every build says what it is** in `plugin-build.json` (src/plugin/pluginBuild.ts): its id, when
//!   it was built, the engine and protocol it was built against, and each file's sha256.
//! - **Only a build this binary can play is taken:** one with the same engine and protocol as the
//!   build built into it (`fits`). An engine change waits for a new binary.
//! - **Checked in the background**, at most hourly, when a window opens (`check_in_background`): a
//!   newer build is downloaded into a folder of its own, each file checked against its hash, and moved
//!   into place only once it's all there, so a half-downloaded build is never served.
//! - **Served from disk** over the same `corrente://` scheme (`Source`), so the page keeps its origin
//!   and with it its storage. Only files its manifest lists are served. The built-in build is the
//!   fallback, offline or before any download.
//! - **A newer plugin** is a GitHub release (PLUGIN-5), which carries its build's manifest too. The
//!   same check reads the latest one's (`release_news`): built later than this binary's own means a
//!   new version is out, and with another engine or protocol, one the window's updates now wait for.
//!
//! Rust notes, for reading this file:
//! - `OnceLock` is a value set once, the first time it's asked for, and shared after (TS: a lazily
//!   filled module-level `let`).
//! - `?` on an `Option` returns `None` from the function if the value is `None` (TS: `if (x === undefined) return;`).
//!   `.ok()` turns a `Result` into an `Option`, dropping the error.
//! - `std::thread::spawn(move || ...)` runs the closure on a new thread; `move` gives it what it uses.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The manifest's name in `dist/`, and its path on the site.
pub const MANIFEST: &str = "plugin-build.json";

/// Where builds come from: corrente.cloud, or another site the plugin was built against (to try this out).
// TS: const SITE = process.env.CORRENTE_UPDATE_URL ?? "https://corrente.cloud";
const SITE: &str = match option_env!("CORRENTE_UPDATE_URL") {
    Some(url) => url,
    None => "https://corrente.cloud",
};

/// Where the latest release's manifest is: GitHub sends this on to the newest release's asset. Or
/// another address the plugin was built against, to try this out.
// TS: const RELEASE = process.env.CORRENTE_RELEASE_URL ?? "https://github.com/alden12/corrente/releases/latest/download";
const RELEASE: &str = match option_env!("CORRENTE_RELEASE_URL") {
    Some(url) => url,
    None => "https://github.com/alden12/corrente/releases/latest/download",
};

/// How often a window opening may check the site.
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);

/// How many downloaded builds are kept: another instance's open window may still be on an older one.
const KEEP: usize = 3;

/// A folder being downloaded into starts with this, and is never served.
const PARTIAL: &str = ".partial-";

/// The largest file taken from the site; the largest in a build today is a few hundred KB.
const LARGEST: u64 = 32 * 1024 * 1024;

// TS: type Build = { id: string; built: number; engine: string; protocol: number; files: { path: string; sha256: string }[] }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Build {
    pub id: String,
    pub built: u64,
    pub engine: String,
    pub protocol: u32,
    pub files: Vec<BuildFile>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct BuildFile {
    pub path: String,
    pub sha256: String,
}

impl Build {
    // TS: return tryParse(JSON.parse(bytes))
    pub fn parse(bytes: &[u8]) -> Option<Build> {
        serde_json::from_slice(bytes).ok()
    }

    /// Whether this build plays on a binary whose own build is `own`: the same engine and protocol.
    // TS: return this.engine === own.engine && this.protocol === own.protocol;
    pub fn fits(&self, own: &Build) -> bool {
        self.engine == own.engine && self.protocol == own.protocol
    }

    // TS: return this.files.find((file) => file.path === path);
    fn file(&self, path: &str) -> Option<&BuildFile> {
        self.files.iter().find(|file| file.path == path)
    }
}

/// The page's files: those built into the plugin, or a downloaded build's folder.
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    BuiltIn,
    Folder(PathBuf, Build),
}

impl Source {
    /// The build the page comes from, or none for the built-in one (which is `own`).
    // TS: return this.kind === "folder" ? this.build.id : undefined;
    pub fn id(&self) -> Option<&str> {
        match self {
            Source::BuiltIn => None,
            Source::Folder(_, build) => Some(&build.id),
        }
    }

    /// The file at `path`, from `built_in` or the folder; a folder serves only what its manifest lists.
    // TS: return this.kind === "builtIn" ? builtIn.find(([name]) => name === path)?.[1] : this.build.file(path) && readFileSync(join(this.folder, path));
    pub fn read(&self, path: &str, built_in: &'static [(&'static str, &'static [u8])]) -> Option<Cow<'static, [u8]>> {
        match self {
            Source::BuiltIn => built_in.iter().find(|(name, _)| *name == path).map(|(_, bytes)| Cow::Borrowed(*bytes)),
            Source::Folder(folder, build) => {
                build.file(path)?;
                std::fs::read(folder.join(path)).ok().map(Cow::Owned)
            }
        }
    }
}

/// The build built into the plugin, from its manifest among `built_in`.
// TS: return Build.parse(builtIn.find(([name]) => name === MANIFEST)?.[1]);
pub fn own_build(built_in: &[(&str, &[u8])]) -> Option<Build> {
    built_in.iter().find(|(name, _)| *name == MANIFEST).and_then(|(_, bytes)| Build::parse(bytes))
}

/// Where downloaded builds are kept: the user's application data, in Corrente's folder.
// TS: return join(appData(), "Corrente", "page-builds");
pub fn builds_folder() -> Option<PathBuf> {
    // `cfg!(...)` is true or false at compile time, as `#[cfg]` is, but usable in an expression.
    let data = if cfg!(target_os = "macos") {
        PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/share")))?
    };
    Some(data.join("Corrente").join("page-builds"))
}

/// Every whole build downloaded into `folder`, with its manifest.
// TS: return readdirSync(folder).filter((name) => !name.startsWith(PARTIAL)).flatMap((name) => { const build = Build.parse(read(join(folder, name, MANIFEST))); return build ? [[join(folder, name), build]] : []; });
fn downloaded(folder: &Path) -> Vec<(PathBuf, Build)> {
    let Ok(entries) = std::fs::read_dir(folder) else { return Vec::new() };
    entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| !path.file_name().is_some_and(|name| name.to_string_lossy().starts_with(PARTIAL)))
        .filter_map(|path| Some((path.clone(), Build::parse(&std::fs::read(path.join(MANIFEST)).ok()?)?)))
        .collect()
}

/// The newest downloaded build in `folder` that fits `own` and is newer than it: what the page should
/// come from. The built-in one if there's none.
// TS: const newest = maxBy(downloaded(folder).filter(([, build]) => build.fits(own) && build.built > own.built), ([, build]) => build.built); return newest ? folder(newest) : builtIn;
pub fn newest(folder: &Path, own: &Build) -> Source {
    downloaded(folder)
        .into_iter()
        .filter(|(_, build)| build.fits(own) && build.built > own.built)
        .max_by_key(|(_, build)| build.built)
        .map_or(Source::BuiltIn, |(path, build)| Source::Folder(path, build))
}

/// A path from a manifest, if it stays inside the build's folder: no `..`, nothing absolute.
// TS: return !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
fn safe(path: &str) -> bool {
    !path.starts_with('/') && !path.contains('\\') && !path.contains(':') && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

// TS: return createHash("sha256").update(bytes).digest("hex");
fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/**
 * Download the site's build into `folder` if it's newer than everything there and fits `own`, and
 * return it. `fetch` gets a path from the site (the manifest's, then each file's). Each file must match
 * its hash, and the folder is moved into place only once it's whole, so one stopped halfway is never
 * served. Then all but the newest few downloaded builds are removed.
 */
// TS:
//   const build = Build.parse(fetch(MANIFEST)); const newestThere = newest(folder, own);
//   if (!build?.fits(own) || build.built <= Math.max(own.built, newestThere.built) || !build.files.every((file) => safe(file.path))) return;
//   const partial = join(folder, PARTIAL + build.id + "-" + process.pid);
//   for (const file of build.files) { const bytes = fetch(file.path); if (sha256(bytes) !== file.sha256) { rm(partial); return; } write(join(partial, file.path), bytes); }
//   write(join(partial, MANIFEST), manifest); rename(partial, join(folder, build.id)); prune(folder); return build;
pub fn download(folder: &Path, own: &Build, fetch: impl Fn(&str) -> Option<Vec<u8>>) -> Option<Build> {
    let manifest = fetch(MANIFEST)?;
    let build = Build::parse(&manifest)?;
    let newest_built = match newest(folder, own) {
        Source::Folder(_, there) => there.built,
        Source::BuiltIn => own.built,
    };
    if !build.fits(own) || build.built <= newest_built || !safe(&build.id) || !build.files.iter().all(|file| safe(&file.path)) {
        return None;
    }
    let partial = folder.join(format!("{PARTIAL}{}-{}", build.id, std::process::id()));
    // `(|| { ... })()` runs a closure at once, so `?` inside it ends only the closure: whatever happens,
    // the line after it tidies up.
    let whole = (|| {
        for file in &build.files {
            let bytes = fetch(&file.path)?;
            if sha256(&bytes) != file.sha256 {
                return None;
            }
            let path = partial.join(&file.path);
            std::fs::create_dir_all(path.parent()?).ok()?;
            std::fs::write(path, bytes).ok()?;
        }
        std::fs::write(partial.join(MANIFEST), &manifest).ok()?;
        std::fs::rename(&partial, folder.join(&build.id)).ok()
    })();
    if whole.is_none() {
        let _ = std::fs::remove_dir_all(&partial);
        return None;
    }
    prune(folder);
    Some(build)
}

/// Remove all but the `KEEP` newest downloaded builds, and folders a stopped download left over a day ago.
// TS: downloaded(folder).sort(byBuiltDescending).slice(KEEP).forEach(([path]) => rm(path)); partials(folder).filter(olderThanADay).forEach(rm);
fn prune(folder: &Path) {
    let mut builds = downloaded(folder);
    builds.sort_by_key(|(_, build)| std::cmp::Reverse(build.built));
    builds.iter().skip(KEEP).for_each(|(path, _)| {
        let _ = std::fs::remove_dir_all(path);
    });
    let a_day = Duration::from_secs(24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(PARTIAL))
        .filter(|entry| entry.metadata().and_then(|metadata| metadata.modified()).is_ok_and(|modified| modified.elapsed().is_ok_and(|age| age > a_day)))
        .for_each(|entry| {
            let _ = std::fs::remove_dir_all(entry.path());
        });
}

/// What's at `url`, or none if it couldn't be had (offline, an error, too large). Redirects are followed.
// TS: try { return await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).bytes(); } catch { return undefined; }
fn from_site(agent: &ureq::Agent, url: &str) -> Option<Vec<u8>> {
    let mut response = agent.get(url).call().ok()?;
    response.body_mut().with_config().limit(LARGEST).read_to_vec().ok()
}

/// What's new about the plugin itself: a newer release, and whether this binary can't take the
/// window's updates any more without it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReleaseNews {
    pub needed: bool,
}

/// What the latest `release` means for a binary whose own build is `own`: news if it was built later.
// TS: return release.built > own.built ? { needed: !release.fits(own) } : undefined;
pub fn release_news(release: &Build, own: &Build) -> Option<ReleaseNews> {
    (release.built > own.built).then(|| ReleaseNews { needed: !release.fits(own) })
}

/// The latest release's news, once a check has read it.
static NEWS: Mutex<Option<ReleaseNews>> = Mutex::new(None);

/// What the last check found about a newer plugin, if anything.
// TS: return news;
pub fn news() -> Option<ReleaseNews> {
    NEWS.lock().ok().and_then(|news| *news)
}

/// When a window last started a check, in this process.
static LAST_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

/// Check the site for a newer build on a thread of its own, unless a window did in the last hour.
// TS:
//   if (lastCheck && Date.now() - lastCheck < CHECK_EVERY) return; lastCheck = Date.now();
//   setTimeout(() => { const folder = buildsFolder(); if (folder) { mkdir(folder); news = releaseNews(latestRelease(), own); download(folder, own, fromSite); } });
pub fn check_in_background(own: Build) {
    let Ok(mut last) = LAST_CHECK.lock() else { return };
    if last.is_some_and(|at| at.elapsed() < CHECK_EVERY) {
        return;
    }
    *last = Some(Instant::now());
    std::thread::spawn(move || {
        let Some(folder) = builds_folder() else { return };
        if std::fs::create_dir_all(&folder).is_err() {
            return;
        }
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
        // TS: const release = Build.parse(await fromSite(`${RELEASE}/${MANIFEST}`)); news = release && releaseNews(release, own);
        let release = from_site(&agent, &format!("{RELEASE}/{MANIFEST}")).and_then(|bytes| Build::parse(&bytes));
        if let (Some(release), Ok(mut news)) = (release, NEWS.lock()) {
            *news = release_news(&release, &own);
        }
        if let Some(build) = download(&folder, &own, |path| from_site(&agent, &format!("{SITE}/{path}"))) {
            nice_plug::nice_log!("a newer page is ready: build {}", build.id);
        }
    });
}
