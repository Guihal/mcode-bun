# MCode Bun

MiniMax Code 0.6.12 on Bun 1.4.3, with compiled bytecode, a SQLite
compatibility adapter and request recovery. An independent distribution by
Guihal, based on [MiniMax Code](https://github.com/MiniMax-AI/minimax-code).

The initial build targets are Windows x64 (Windows 10 1809+) and Linux x64
with glibc. Linux runtime checks are run locally. The Windows archive is
cross-compiled and has not yet been verified on native Windows; installer and
runtime fixtures are included for that testing. Authenticated interactive/model
session acceptance also remains a separate user check.

## Install on Windows

Run in Windows PowerShell 5.1 or later:

    & ([scriptblock]::Create((Invoke-RestMethod https://raw.githubusercontent.com/Guihal/mcode-bun/main/install.ps1)))

The installer downloads the complete archive and SHA-256 checksum, validates
the payload, installs under %LOCALAPPDATA%\MCodeBun and registers mcode and
mcode-tools on User PATH. Reopen already-open terminals. No Node, Bun, npm,
Git, compiler, source build or manual patching is required to install it.
The Windows core shell uses built-in PowerShell; Git Bash and PowerShell 7
remain optional shell choices.

Local zip installation (keep its adjacent .sha256 file):

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ArchivePath .\mcode-0.6.12-bun.2-win32-x64.zip
    mcode --version
    mcode-tools --version

Expected versions are 0.6.12 and 0.0.6. Rerun the same installer to upgrade
or repair. Releases occupy distinct directories; command routing switches
after validation. The upstream updater cannot replace this distribution.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall

Uninstall removes owned routing and recorded distribution files. Configuration,
credentials and sessions are preserved. Keep user files outside payload roots.

## Linux and normal use

Download the Linux tar.gz and adjacent .sha256 from Releases, verify with
sha256sum -c, extract into a dedicated directory and run ./mcode or
./mcode-tools. Optionally add that directory to PATH. Bash and normal Linux
OS utilities are used for shell tools. The build performs no global registration.

Run mcode in your project. Use mcode login for MiniMax, or configure your
own provider through the /model menu or mcode provider --help. Ordinary
upstream account/provider requirements still apply. Data follows upstream's
normal ~/.minimax location unless explicitly configured otherwise.

Keep the entire archive directory together: it contains the compiled app,
private interpreter in runtime/, physical package/ with workers/WASM/assets,
platform clipboard/ripgrep dependencies, tools launchers, notices and manifest.
Optional browser, document, development toolchains and SDK integrations retain
their own requirements. The Unix daemon is unavailable on Windows; stdio
app-server remains available.

Recovery allows five retries after the initial failed provider attempt, stops
on caller cancellation, and publishes text/tools only from a complete
successful attempt. Exhaustion is a failure. Incremental text streaming is
traded for safe partial-failure recovery. No unlimited-reliability or measured
RAM/performance guarantee is made.

All model requests use `service_tier: "priority"`, including auxiliary generation,
compaction, retries and remote message token counting.

Undo snapshots copy mutable containers while sharing immutable paste strings.
Canonical history uses bounded JSONL reads, explicit immutable snapshot sharing
and a verified append index; uncertain changes use the full recovery scanner.
Image resizing tries encodings sequentially in a physical worker that terminates
after each operation, releasing its Photon/WASM state.

Native tool catalogs and permission preparation remain available at startup.
Local tools, goals, computer-use, Matrix media and browser operations load their
implementations from physical package modules on first use. Fetch/deploy keep
their configuration captures at owner creation; operation helpers and JSZip
initialize when used. Extension initialization and tool registration retain their
existing timing. Keep the complete package with the executable: all deferred
modules are covered by the distribution manifest.

## Maintainer build and checks

Use Bun 1.4.3 on the target OS (plus tar and Python 3 for Linux cross-builds):

    bun install --frozen-lockfile --ignore-scripts
    bun scripts/build.mjs
    bun tests/distribution.mjs

Focused capability parity and compiled first-use checks use a pristine acquired
package plus a complete candidate package:

    MCODE_TEST_TMP=/path/to/disk-scratch bun tests/memory-capabilities.mjs /path/to/pristine/package /path/to/candidate/package

This uses owned adapter/client stubs for all 18 Matrix tools, all 17 computer-use
tools, both goal tools, browser exposure, fetch and deployment. It checks live
permission revocation, cancellation cleanup, per-owner goal state and all 24
physical capability modules in a compiled probe. Startup/first-use timings and
diagnostic live heap are printed separately from ordinary CLI process samples.

To cross-build the complete Windows ZIP on Linux:

    bun scripts/build.mjs --target=win32-x64

This installs locked Windows dependencies in build scratch and downloads a
SHA-256-pinned official Windows Bun executable. It does not execute Windows
binaries or establish native Windows compatibility.

The build fetches the exact npm 0.6.12 tarball and checks the SHA-256 in
[package.json](package.json), applies exact transformations, and installs
dependencies from [bun.lock](bun.lock). No upstream SQLite postinstall runs.
Generated trees/archives live in ignored .build/ and dist/; personal installation
or configuration trees are never imported. [Native CI](.github/workflows/release.yml)
can build and test future release bytes when hosted runners are available.
The first Windows release is published for user testing without a native CI pass.
Controlled fixtures use disposable data and synthetic
loopback credentials, not an authenticated personal session.

Linux builds also record bytecode layout profiles from `--help` and the local
`recover` fixture, then recompile and refresh the manifest. Profiles stay in
build scratch; no personal sessions or private profile files are used. Windows
and cross-target builds retain the default layout. Full bytecode depth is kept,
and `--smol` is not embedded: repeated Linux eight-tool comparisons showed no
consistent memory improvement from either `--smol` or depth 1. Profile ordering
reduced parent peak RSS from 367–377 MiB to 342–345 MiB in that workload, with
similar total latency (about 21–22 seconds, including deliberate tool delays).
These are workload observations, not a RAM limit or a promise for other sessions.

Run matched comparisons with the same round count and reverse their order:

    MCODE_TEST_TMP=/path/to/disk-scratch bun tests/native-retry.mjs /path/to/mcode soak
    MCODE_TEST_TMP=/path/to/disk-scratch MCODE_SOAK_ROUNDS=8 bun tests/native-retry.mjs /path/to/mcode soak

The default soak runs 40 useful shell operations with injected partial failures.
It checks bounded retries, completed artifacts and absence of failed text/tools
in output and stored history. On Linux it writes 100 ms parent/recursive-child
RSS, PSS, private-page and anonymous-PSS samples to its printed fixture directory,
including first-request and post-work provider-wait phases. The production CLI
does not expose JS heap statistics; these process measurements do not imply
heap measurements. Run without profiling variables for memory comparisons.

Authored distribution code is MIT. The npm package declares MIT. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the archive's licenses/ for
upstream and dependency attribution, including Bun's linked libraries.
