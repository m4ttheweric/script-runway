import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// File script type registry
// ---------------------------------------------------------------------------

interface FileScriptType {
  kind: string;
  label: string;
  extensions: string[];
  iconFile: string;
  /** Optional separate icon for individual file items (falls back to theme resourceUri if unset) */
  fileIconFile?: string;
  makeCommand: (filename: string) => string;
  boilerplate: string;
}

const FILE_SCRIPT_TYPES: FileScriptType[] = [
  {
    kind: "shell", label: "Shell Scripts",
    extensions: [".sh", ".bash", ".zsh"], iconFile: "shell.svg", fileIconFile: "emoji-shell.svg",
    makeCommand: (f) => `bash "${f}"`,
    boilerplate: "#!/bin/bash\nset -e\n\n# TODO: add your commands here\n",
  },
  {
    kind: "python", label: "Python Scripts",
    extensions: [".py"], iconFile: "python.svg",
    makeCommand: (f) => `python3 "${f}"`,
    boilerplate: "#!/usr/bin/env python3\n\ndef main():\n    pass\n\nif __name__ == '__main__':\n    main()\n",
  },
  {
    kind: "javascript", label: "JavaScript Scripts",
    extensions: [".js", ".mjs", ".cjs"], iconFile: "js.svg",
    makeCommand: (f) => `node "${f}"`,
    boilerplate: "#!/usr/bin/env node\n\nasync function main() {\n  // TODO\n}\n\nmain().catch(console.error);\n",
  },
  {
    kind: "typescript", label: "TypeScript Scripts",
    extensions: [".ts"], iconFile: "ts.svg",
    makeCommand: (f) => `npx tsx "${f}"`,
    boilerplate: "#!/usr/bin/env npx tsx\n\nasync function main(): Promise<void> {\n  // TODO\n}\n\nmain().catch(console.error);\n",
  },
  {
    kind: "ruby", label: "Ruby Scripts",
    extensions: [".rb"], iconFile: "ruby.svg",
    makeCommand: (f) => `ruby "${f}"`,
    boilerplate: "#!/usr/bin/env ruby\n\n# TODO\n",
  },
  {
    kind: "php", label: "PHP Scripts",
    extensions: [".php"], iconFile: "php.svg",
    makeCommand: (f) => `php "${f}"`,
    boilerplate: "<?php\n\n// TODO\n",
  },
  {
    kind: "perl", label: "Perl Scripts",
    extensions: [".pl"], iconFile: "perl.svg",
    makeCommand: (f) => `perl "${f}"`,
    boilerplate: "#!/usr/bin/env perl\nuse strict;\nuse warnings;\n\n# TODO\n",
  },
  {
    kind: "powershell", label: "PowerShell Scripts",
    extensions: [".ps1"], iconFile: "powershell.svg",
    makeCommand: (f) => `pwsh "${f}"`,
    boilerplate: "# TODO\n",
  },
  {
    kind: "go", label: "Go Scripts",
    extensions: [".go"], iconFile: "go.svg",
    makeCommand: (f) => `go run "${f}"`,
    boilerplate: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Hello\")\n}\n",
  },
  {
    kind: "swift", label: "Swift Scripts",
    extensions: [".swift"], iconFile: "swift.svg",
    makeCommand: (f) => `swift "${f}"`,
    boilerplate: "#!/usr/bin/env swift\n\nimport Foundation\n\n// TODO\n",
  },
  {
    kind: "makefile", label: "Makefile",
    extensions: [], iconFile: "makefile.svg", // handled specially
    makeCommand: (target) => `make ${target}`,
    boilerplate: "",
  },
];

const EXT_TO_TYPE = new Map<string, FileScriptType>();
for (const t of FILE_SCRIPT_TYPES) {
  for (const ext of t.extensions) EXT_TO_TYPE.set(ext, t);
}

// ---------------------------------------------------------------------------
// Source store  (workspace-state — not committed to settings.json)
// ---------------------------------------------------------------------------

type SourceType = "packageJson" | "directory" | "file";

interface Source {
  type: SourceType;
  /** absolute path */
  path: string;
}

class SourceStore {
  private static readonly KEY = "runway.sources";
  constructor(private readonly state: vscode.Memento) {}

  getAll(): Source[] {
    return this.state.get<Source[]>(SourceStore.KEY) ?? [];
  }

  async add(source: Source): Promise<boolean> {
    const all = this.getAll();
    if (all.some((s) => s.path === source.path && s.type === source.type)) return false;
    await this.state.update(SourceStore.KEY, [...all, source]);
    return true;
  }

  async remove(sourcePath: string): Promise<void> {
    await this.state.update(
      SourceStore.KEY,
      this.getAll().filter((s) => s.path !== sourcePath)
    );
  }
}

// ---------------------------------------------------------------------------
// Generic key-value store for overrides and labels
// ---------------------------------------------------------------------------

class ScriptStore {
  constructor(private readonly state: vscode.Memento, private readonly key: string) {}

  get(id: string): string | undefined {
    return this.all()[id];
  }

  async set(id: string, value: string) {
    const all = this.all();
    all[id] = value;
    await this.state.update(this.key, all);
  }

  async clear(id: string) {
    const all = this.all();
    delete all[id];
    await this.state.update(this.key, all);
  }

  private all(): Record<string, string> {
    return this.state.get<Record<string, string>>(this.key) ?? {};
  }
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

type PM = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Scans canonical lifecycle script commands for unambiguous PM CLI invocations.
 * Only looks at well-known scripts (start, dev, build, run, test) to avoid
 * false signals from one-off tool calls in less predictable scripts.
 * Checked in specificity order so e.g. "pnpm" wins over a stray "npx".
 */
function inferPMFromScripts(scripts: Record<string, string>): PM | undefined {
  const LIFECYCLE = ["start", "dev", "build", "run"];
  const combined = LIFECYCLE.flatMap((k) => (scripts[k] ? [scripts[k]] : [])).join("\n");
  if (/\bpnpm\b/.test(combined)) return "pnpm";
  if (/\bbunx\b|\bbun\s/.test(combined)) return "bun";
  if (/\byarn\b/.test(combined)) return "yarn";
  if (/\bnpx\b/.test(combined)) return "npm";
  return undefined;
}

function detectPM(pkgDir: string): PM {
  // 1. Explicit packageManager field
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    if (typeof pkg.packageManager === "string") {
      if (pkg.packageManager.startsWith("pnpm")) return "pnpm";
      if (pkg.packageManager.startsWith("yarn")) return "yarn";
      if (pkg.packageManager.startsWith("bun")) return "bun";
    }

    // 2. Lock files (more reliable than script text)
    if (fs.existsSync(path.join(pkgDir, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(pkgDir, "bun.lockb"))) return "bun";
    if (fs.existsSync(path.join(pkgDir, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(pkgDir, "package-lock.json"))) return "npm";

    // 3. Infer from script command patterns
    if (pkg.scripts && typeof pkg.scripts === "object") {
      const inferred = inferPMFromScripts(pkg.scripts);
      if (inferred) return inferred;
    }
  } catch { /* ignore */ }

  return "npm";
}

// ---------------------------------------------------------------------------
// Path display helper
// ---------------------------------------------------------------------------

function displayPath(absPath: string): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (wsRoot) {
    const rel = path.relative(wsRoot, absPath);
    if (!rel.startsWith("..")) return rel;
  }
  return absPath;
}

// ---------------------------------------------------------------------------
// Makefile target parser
// ---------------------------------------------------------------------------

function parseMakeTargets(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const seen = new Set<string>();
    const targets: string[] = [];
    for (const m of content.matchAll(/^([a-zA-Z0-9][a-zA-Z0-9_.-]*)\s*:/gm)) {
      if (!seen.has(m[1])) { seen.add(m[1]); targets.push(m[1]); }
    }
    return targets;
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Script name → icon mapping
// ---------------------------------------------------------------------------

type ScriptIcon = vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri };

/**
 * Returns an icon for well-known npm script names, or undefined for
 * anything that doesn't match a recognisable pattern.
 * Matches exact names or names starting with the keyword followed by
 * a separator (`:`, `-`, `_`), e.g. "build:watch" → package icon.
 */
function iconForScript(name: string, extensionUri: vscode.Uri): ScriptIcon | undefined {
  const n = name.toLowerCase();
  const sw = (...prefixes: string[]) =>
    prefixes.some((p) => n === p || n.startsWith(p + ":") || n.startsWith(p + "-") || n.startsWith(p + "_"));

  const emoji = (file: string) => {
    const uri = vscode.Uri.joinPath(extensionUri, "images", file);
    return { light: uri, dark: uri };
  };

  if (sw("dev", "start", "serve", "server"))                              return emoji("emoji-lightning.svg");
  if (sw("build", "compile", "bundle"))                                   return emoji("emoji-package.svg");
  if (sw("test", "spec", "e2e"))                                          return emoji("emoji-test-tube.svg");
  if (sw("lint", "eslint", "tslint", "stylelint", "format", "fmt", "prettier")) return emoji("emoji-nail-polish.svg");
  if (sw("typecheck", "type-check", "types", "tsc"))                      return emoji("emoji-magnifier.svg");
  if (sw("clean", "reset"))                                               return emoji("emoji-broom.svg");
  if (sw("deploy", "release", "publish"))                                 return emoji("emoji-rocket.svg");
  if (sw("watch"))                                                        return emoji("emoji-eyes.svg");
  if (sw("preview"))                                                      return emoji("emoji-eyes.svg");
  if (sw("migrate", "migration", "seed", "db"))                           return emoji("emoji-cabinet.svg");
  if (sw("generate", "gen", "scaffold"))                                  return emoji("emoji-sparkles.svg");
  if (sw("doc", "docs", "storybook"))                                     return emoji("emoji-books.svg");
  if (sw("install", "setup", "bootstrap"))                                return emoji("emoji-inbox.svg");
  return undefined;
}

// ---------------------------------------------------------------------------
// Tree data types
// ---------------------------------------------------------------------------

type ScriptKind =
  | "packageGroup"
  | "npmScript"
  | "makeGroup"
  | "makeTarget"
  | "fileCategory"
  | "fileScript";

interface Script {
  kind: ScriptKind;
  label: string;
  /** stable key for overrides/labels */
  id?: string;
  defaultCommand?: string;
  cwd?: string;
  /** absolute path to the source file */
  filePath?: string;
  /** SVG icon filename for category/group headers */
  iconFile?: string;
  /** absolute path of the source that added this item (for removal) */
  sourcePath?: string;
  /** detected package manager, for tooltips */
  pm?: PM;
  /** category kind, for fileCategory routing */
  categoryKind?: string;
  /** secondary descriptive text shown in the row */
  description?: string;
}

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

class ScriptItem extends vscode.TreeItem {
  constructor(
    public readonly script: Script,
    private readonly extensionUri: vscode.Uri,
    overrides: ScriptStore,
    labels: ScriptStore,
    runningTerminals: Set<string>
  ) {
    const collapsible =
      script.kind === "packageGroup" ||
      script.kind === "makeGroup" ||
      script.kind === "fileCategory"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;

    super(script.label, collapsible);

    const override = script.id ? overrides.get(script.id) : undefined;
    const customLabel = script.id ? labels.get(script.id) : undefined;
    const effectiveCommand = override ?? script.defaultCommand;
    const isOverridden = override !== undefined;
    const isRunning = script.id !== undefined && runningTerminals.has(script.label);

    if (customLabel) {
      this.label = customLabel;
      this.description = script.label;
    }

    switch (script.kind) {
      case "packageGroup":
        this.contextValue = "packageGroup";
        this.iconPath = this.svgIcon(script.iconFile ?? "npm.svg");
        this.description = script.pm ?? "npm";
        this.tooltip = `${script.pm ?? "npm"} • ${script.filePath}`;
        break;

      case "makeGroup":
        this.contextValue = "makeGroup";
        this.iconPath = this.svgIcon("makefile.svg");
        this.description = displayPath(script.filePath!);
        this.tooltip = script.filePath;
        break;

      case "fileCategory":
        this.contextValue = "fileCategory";
        this.iconPath = this.svgIcon(script.iconFile!);
        break;

      case "npmScript":
        this.contextValue = isRunning
          ? (isOverridden ? "runnable-active-overridden" : "runnable-active")
          : (isOverridden ? "runnable-idle-overridden" : "runnable-idle");
        this.iconPath = isOverridden
          ? new vscode.ThemeIcon("wrench")
          : iconForScript(script.label, extensionUri);
        if (isRunning) this.resourceUri = vscode.Uri.parse(`runway-running://${encodeURIComponent(script.label)}`);
        if (!customLabel) this.description = effectiveCommand;
        this.tooltip = isRunning
          ? `Running — double-click to stop\n${script.defaultCommand}`
          : isOverridden
            ? `Override: ${override}\nDefault: ${script.defaultCommand}`
            : script.defaultCommand;
        this.command = { command: "runway.itemClicked", title: "Run", arguments: [this] };
        break;

      case "makeTarget":
        this.contextValue = isRunning
          ? (isOverridden ? "runnable-active-overridden" : "runnable-active")
          : (isOverridden ? "runnable-idle-overridden" : "runnable-idle");
        this.iconPath = isOverridden ? new vscode.ThemeIcon("wrench") : undefined;
        if (isRunning) this.resourceUri = vscode.Uri.parse(`runway-running://${encodeURIComponent(script.label)}`);
        if (!customLabel) this.description = effectiveCommand;
        this.command = { command: "runway.itemClicked", title: "Run", arguments: [this] };
        this.tooltip = isRunning
          ? `Running — double-click to stop\n${script.defaultCommand}`
          : isOverridden
            ? `Override: ${override}\nDefault: ${script.defaultCommand}`
            : script.defaultCommand;
        break;

      case "fileScript":
        this.contextValue = isRunning
          ? (isOverridden ? "runnable-active-overridden" : "runnable-active")
          : (isOverridden ? "runnable-idle-overridden" : "runnable-idle");
        if (script.iconFile) {
          this.iconPath = this.svgIcon(script.iconFile);
        } else {
          this.resourceUri = vscode.Uri.file(script.filePath!);
        }
        if (isRunning) this.resourceUri = vscode.Uri.parse(`runway-running://${encodeURIComponent(script.label)}`);
        if (!customLabel && isOverridden) this.description = override;
        this.tooltip = isRunning
          ? `Running — double-click to stop\n${script.filePath}`
          : isOverridden
            ? `Override: ${override}\nDefault: ${script.defaultCommand}`
            : script.filePath;
        this.command = { command: "runway.itemClicked", title: "Run", arguments: [this] };
        break;
    }
  }

  private svgIcon(filename: string): { light: vscode.Uri; dark: vscode.Uri } {
    const uri = vscode.Uri.joinPath(this.extensionUri, "images", filename);
    return { light: uri, dark: uri };
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

class ScriptProvider implements vscode.TreeDataProvider<ScriptItem> {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sources: SourceStore,
    private readonly overrides: ScriptStore,
    private readonly labels: ScriptStore,
    private readonly runningTerminals: Set<string>
  ) {}

  refresh() { this._onChange.fire(); }

  getTreeItem(item: ScriptItem): vscode.TreeItem { return item; }

  async getChildren(parent?: ScriptItem): Promise<ScriptItem[]> {
    if (!parent) return this.roots();

    switch (parent.script.kind) {
      case "packageGroup": return this.npmScripts(parent.script);
      case "makeGroup":    return this.makeTargets(parent.script);
      case "fileCategory": return this.fileCategoryChildren(parent.script);
      default:             return [];
    }
  }

  // -- Root items ----------------------------------------------------------

  private async roots(): Promise<ScriptItem[]> {
    const all = this.sources.getAll();
    const items: ScriptItem[] = [];

    // 1. Package.json groups
    for (const src of all.filter((s) => s.type === "packageJson")) {
      const item = this.packageGroupItem(src.path);
      if (item) items.push(item);
    }

    // 2. Makefile groups (from directory sources)
    for (const src of all.filter((s) => s.type === "directory")) {
      for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
        const mkPath = path.join(src.path, name);
        if (!fs.existsSync(mkPath)) continue;
        if (!parseMakeTargets(mkPath).length) break;
        items.push(
          this.item({
            kind: "makeGroup",
            label: displayPath(src.path),
            filePath: mkPath,
            cwd: src.path,
            sourcePath: src.path,
          })
        );
        break;
      }
    }

    // 3. File-type categories (from directory + file sources)
    const categoryItems = await this.fileCategoryHeaders(all);
    items.push(...categoryItems);

    return items;
  }

  // -- Package groups ------------------------------------------------------

  private packageGroupItem(pkgPath: string): ScriptItem | undefined {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (!pkg.scripts || !Object.keys(pkg.scripts).length) return undefined;

      const dir = path.dirname(pkgPath);
      const pm = detectPM(dir);
      const appName = pkg.name || path.basename(dir);
      const pmIconFile = pm === "pnpm" ? "pnpm.svg"
        : pm === "yarn" ? "yarn.svg"
        : pm === "bun"  ? "bun.svg"
        : "npm.svg";

      return this.item({
        kind: "packageGroup",
        label: appName,
        filePath: pkgPath,
        cwd: dir,
        sourcePath: pkgPath,
        pm,
        iconFile: pmIconFile,
      });
    } catch { return undefined; }
  }

  private npmScripts(group: Script): ScriptItem[] {
    try {
      const pkg = JSON.parse(fs.readFileSync(group.filePath!, "utf8"));
      const pm = group.pm ?? "npm";
      return Object.entries<string>(pkg.scripts ?? {}).map(([name, cmd]) =>
        this.item({
          kind: "npmScript",
          label: name,
          id: `npm:${group.filePath}:${name}`,
          defaultCommand: `${pm} run ${name}`,
          cwd: group.cwd,
          filePath: group.filePath,
          description: cmd,
        })
      );
    } catch { return []; }
  }

  // -- Makefile ------------------------------------------------------------

  private makeTargets(group: Script): ScriptItem[] {
    return parseMakeTargets(group.filePath!).map((target) =>
      this.item({
        kind: "makeTarget",
        label: target,
        id: `make:${group.filePath}:${target}`,
        defaultCommand: `make ${target}`,
        cwd: group.cwd,
        filePath: group.filePath,
      })
    );
  }

  // -- File categories -----------------------------------------------------

  private async fileCategoryHeaders(all: Source[]): Promise<ScriptItem[]> {
    const dirSources = all.filter((s) => s.type === "directory");
    const fileSources = all.filter((s) => s.type === "file");
    const categories: ScriptItem[] = [];

    for (const type of FILE_SCRIPT_TYPES) {
      if (!type.extensions.length) continue; // makefile handled separately

      let hasAny = false;

      // Check directories
      for (const src of dirSources) {
        if (!fs.existsSync(src.path)) continue;
        if (fs.readdirSync(src.path).some((f) => type.extensions.includes(path.extname(f)))) {
          hasAny = true;
          break;
        }
      }

      // Check individual file sources
      if (!hasAny) {
        hasAny = fileSources.some((s) => type.extensions.includes(path.extname(s.path)));
      }

      if (hasAny) {
        categories.push(
          this.item({
            kind: "fileCategory",
            label: type.label,
            iconFile: type.iconFile,
            categoryKind: type.kind,
          })
        );
      }
    }

    return categories;
  }

  private fileCategoryChildren(cat: Script): ScriptItem[] {
    const type = FILE_SCRIPT_TYPES.find((t) => t.kind === cat.categoryKind);
    if (!type) return [];

    const all = this.sources.getAll();
    const items: ScriptItem[] = [];
    const seen = new Set<string>();

    // From directory sources
    for (const src of all.filter((s) => s.type === "directory")) {
      if (!fs.existsSync(src.path)) continue;
      const files = fs.readdirSync(src.path)
        .filter((f) => type.extensions.includes(path.extname(f)))
        .sort();

      for (const file of files) {
        const absPath = path.join(src.path, file);
        if (seen.has(absPath)) continue;
        seen.add(absPath);
        items.push(this.fileScriptItem(absPath, src.path, type, file));
      }
    }

    // From individual file sources
    for (const src of all.filter((s) => s.type === "file")) {
      if (seen.has(src.path)) continue;
      if (!type.extensions.includes(path.extname(src.path))) continue;
      seen.add(src.path);
      items.push(this.fileScriptItem(src.path, path.dirname(src.path), type, path.basename(src.path)));
    }

    return items;
  }

  private fileScriptItem(absPath: string, cwd: string, type: FileScriptType, filename: string): ScriptItem {
    return this.item({
      kind: "fileScript",
      label: displayPath(absPath),
      id: `file:${absPath}`,
      defaultCommand: type.makeCommand(filename),
      cwd,
      filePath: absPath,
      sourcePath: absPath,
      iconFile: type.fileIconFile,
    });
  }

  // -- Helper --------------------------------------------------------------

  private item(script: Script): ScriptItem {
    return new ScriptItem(script, this.extensionUri, this.overrides, this.labels, this.runningTerminals);
  }
}

// ---------------------------------------------------------------------------
// Watcher manager — keeps FileSystemWatchers in sync with the source list
// ---------------------------------------------------------------------------

class WatcherManager implements vscode.Disposable {
  private readonly watchers = new Map<string, vscode.Disposable[]>();

  constructor(
    private readonly sources: SourceStore,
    private readonly onRefresh: () => void
  ) {}

  /** Call after any source is added or removed to reconcile watchers. */
  sync() {
    const all = this.sources.getAll();
    const currentPaths = new Set(all.map((s) => s.path));

    // Tear down watchers for sources that were removed
    for (const [p, disposables] of this.watchers) {
      if (!currentPaths.has(p)) {
        disposables.forEach((d) => d.dispose());
        this.watchers.delete(p);
      }
    }

    // Set up watchers for newly added sources
    for (const src of all) {
      if (this.watchers.has(src.path)) continue;

      const disposables: vscode.Disposable[] = [];

      if (src.type === "packageJson") {
        // Watch the specific package.json file for edits
        const dir = vscode.Uri.file(path.dirname(src.path));
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(dir, path.basename(src.path))
        );
        watcher.onDidChange(this.onRefresh);
        watcher.onDidCreate(this.onRefresh);
        watcher.onDidDelete(this.onRefresh);
        disposables.push(watcher);
      } else if (src.type === "directory") {
        // Watch for any file added/removed/changed directly inside the directory
        // (covers new script files and Makefile edits)
        const dir = vscode.Uri.file(src.path);
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(dir, "*")
        );
        watcher.onDidChange(this.onRefresh);
        watcher.onDidCreate(this.onRefresh);
        watcher.onDidDelete(this.onRefresh);
        disposables.push(watcher);
      }

      this.watchers.set(src.path, disposables);
    }
  }

  dispose() {
    for (const disposables of this.watchers.values()) {
      disposables.forEach((d) => d.dispose());
    }
    this.watchers.clear();
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

class RunningDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme === "runway-running") {
      return {
        badge: "▶",
        color: new vscode.ThemeColor("list.warningForeground"),
        propagate: false,
      };
    }
    return undefined;
  }

  fire(uris: vscode.Uri[]) {
    this._onDidChange.fire(uris);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const sources = new SourceStore(context.workspaceState);
  const overrides = new ScriptStore(context.workspaceState, "runway.overrides");
  const labels = new ScriptStore(context.workspaceState, "runway.labels");
  // Seeded with any terminals already open when the extension activates
  const runningTerminals = new Set<string>(vscode.window.terminals.map((t) => t.name));
  const provider = new ScriptProvider(context.extensionUri, sources, overrides, labels, runningTerminals);
  const decorationProvider = new RunningDecorationProvider();

  const treeView = vscode.window.createTreeView("runwayView", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider)
  );

  const watcherManager = new WatcherManager(sources, () => provider.refresh());
  // Attach watchers for any sources persisted from a previous session
  watcherManager.sync();

  function markRunning(name: string) {
    runningTerminals.add(name);
    decorationProvider.fire([vscode.Uri.parse(`runway-running://${encodeURIComponent(name)}`)]);
    provider.refresh();
  }

  function markStopped(name: string) {
    runningTerminals.delete(name);
    decorationProvider.fire([vscode.Uri.parse(`runway-running://${encodeURIComponent(name)}`)]);
    provider.refresh();
  }

  // terminal name → command waiting for shell integration to activate
  const pendingCommands = new Map<string, string>();
  // terminal name → the TerminalShellExecution we started (to match end events)
  const trackedExecutions = new Map<string, vscode.TerminalShellExecution>();

  // Track terminal lifecycle to update running indicators and decorations
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => markRunning(t.name)),
    vscode.window.onDidCloseTerminal((t) => {
      pendingCommands.delete(t.name);
      trackedExecutions.delete(t.name);
      markStopped(t.name);
    }),

    // Shell integration activated — run the pending command via executeCommand
    // so that onDidEndTerminalShellExecution fires when it exits.
    vscode.window.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
      const command = pendingCommands.get(terminal.name);
      if (command) {
        pendingCommands.delete(terminal.name);
        const execution = shellIntegration.executeCommand(command);
        trackedExecutions.set(terminal.name, execution);
      }
    }),

    // Fired when a shell-integration-tracked command ends (Ctrl+C, crash, natural exit).
    vscode.window.onDidEndTerminalShellExecution((event) => {
      const name = event.terminal.name;
      if (trackedExecutions.get(name) === event.execution) {
        trackedExecutions.delete(name);
        markStopped(name);
      }
    })
  );

  // Double-click to run (or stop if already running).
  // Uses TreeItem.command rather than onDidChangeSelection so it fires even
  // when the item is already selected.
  let lastClickKey = "";
  let lastClickTime = 0;
  context.subscriptions.push(
    vscode.commands.registerCommand("runway.itemClicked", (item: ScriptItem) => {
      if (!item?.script.id) return;

      const key = item.script.id;
      const now = Date.now();
      const { script } = item;
      const terminal = vscode.window.terminals.find((t) => t.name === script.label);

      if (key === lastClickKey && now - lastClickTime < 300) {
        // Double-click
        if (terminal && runningTerminals.has(script.label)) {
          // Script is running — stop it
          terminal.sendText("\x03");
          terminal.show();
          markStopped(script.label);
        } else {
          // Not running — start it
          const override = script.id ? overrides.get(script.id) : undefined;
          runInTerminal(script, override ?? script.defaultCommand ?? "", markRunning, pendingCommands, trackedExecutions);
        }
        lastClickKey = "";
      } else {
        // Single click — focus existing terminal if one is open
        if (terminal) terminal.show();
        lastClickKey = key;
        lastClickTime = now;
      }
    }),

    ...["Terminal", "Warp", "iTerm", "iTerm2"].map((app) =>
      vscode.commands.registerCommand(`runway.openInSystemTerminal.${app}`, (item: ScriptItem) => {
        const { script } = item;
        const override = script.id ? overrides.get(script.id) : undefined;
        const command = override ?? script.defaultCommand ?? "";
        openInSystemTerminal(script.cwd ?? "", command);
      })
    ),

    vscode.commands.registerCommand("runway.openSourceFile", async (item: ScriptItem) => {
      const { script } = item;
      const filePath = script.filePath;
      if (!filePath) return;

      const uri = vscode.Uri.file(filePath);

      if (script.kind === "npmScript") {
        // Jump to the exact line of this script in package.json
        const doc = await vscode.workspace.openTextDocument(uri);
        const match = new RegExp(`"${script.label}"\\s*:`).exec(doc.getText());
        if (match) {
          const pos = doc.positionAt(match.index);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(pos, pos),
          });
          return;
        }
      }

      await vscode.commands.executeCommand("vscode.open", uri);
    }),

    vscode.commands.registerCommand("runway.stop", (item: ScriptItem) => {
      const terminal = vscode.window.terminals.find((t) => t.name === item.script.label);
      if (terminal) {
        terminal.sendText("\x03");
        terminal.show();
        markStopped(item.script.label);
      }
    })
  );

  // Show welcome message when no sources are added
  function updateMessage() {
    treeView.message = sources.getAll().length === 0
      ? "No scripts added yet. Click + to add a package.json, directory, or script file."
      : undefined;
  }
  updateMessage();

  context.subscriptions.push(
    treeView,
    watcherManager,

    vscode.commands.registerCommand("runway.refresh", () => {
      provider.refresh();
      updateMessage();
    }),

    vscode.commands.registerCommand(
      "runway.run",
      (item: ScriptItem) => {
        const { script } = item;
        const override = script.id ? overrides.get(script.id) : undefined;
        const command = override ?? script.defaultCommand ?? "";
        runInTerminal(script, command, markRunning, pendingCommands, trackedExecutions);
      }
    ),

    vscode.commands.registerCommand(
      "runway.setOverride",
      async (item: ScriptItem) => {
        const { script } = item;
        if (!script.id) return;
        const current = overrides.get(script.id) ?? script.defaultCommand ?? "";
        const input = await vscode.window.showInputBox({
          prompt: `Override command for "${script.label}"`,
          value: current,
          validateInput: (v) => (v.trim() ? null : "Command cannot be empty"),
        });
        if (input === undefined) return;
        await overrides.set(script.id, input.trim());
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "runway.clearOverride",
      async (item: ScriptItem) => {
        if (!item.script.id) return;
        await overrides.clear(item.script.id);
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "runway.setLabel",
      async (item: ScriptItem) => {
        const { script } = item;
        if (!script.id) return;
        const current = labels.get(script.id) ?? "";
        const input = await vscode.window.showInputBox({
          prompt: `Display name for "${script.label}"`,
          value: current,
          placeHolder: "e.g. Build & Install",
        });
        if (input === undefined) return;
        input.trim() === ""
          ? await labels.clear(script.id)
          : await labels.set(script.id, input.trim());
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "runway.clearLabel",
      async (item: ScriptItem) => {
        if (!item.script.id) return;
        await labels.clear(item.script.id);
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "runway.removeSource",
      async (item: ScriptItem) => {
        const src = item.script.sourcePath ?? item.script.filePath;
        if (!src) return;
        await sources.remove(src);
        watcherManager.sync();
        provider.refresh();
        updateMessage();
      }
    ),

    vscode.commands.registerCommand(
      "runway.manageSources",
      async () => {
        const all = sources.getAll();
        if (!all.length) {
          vscode.window.showInformationMessage("No sources added yet.");
          return;
        }
        const choices = all.map((s) => ({
          label: `$(trash) ${displayPath(s.path)}`,
          description: s.type,
          path: s.path,
        }));
        const picked = await vscode.window.showQuickPick(choices, {
          placeHolder: "Select a source to remove",
          canPickMany: true,
        });
        if (!picked?.length) return;
        for (const p of picked) await sources.remove(p.path);
        watcherManager.sync();
        provider.refresh();
        updateMessage();
      }
    ),

    vscode.commands.registerCommand("runway.add", async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(package)  Add package.json", value: "packageJson" },
          { label: "$(folder-opened)  Add Directory", value: "directory" },
          { label: "$(file-code)  Add Script File", value: "file" },
          { label: "$(trash)  Remove Sources...", value: "manage" },
        ],
        { placeHolder: "What do you want to do?" }
      );
      if (!choice) return;

      if (choice.value === "manage") {
        await vscode.commands.executeCommand("runway.manageSources");
        return;
      }

      if (choice.value === "packageJson") {
        await addPackageJson(sources, provider, watcherManager, updateMessage);
      } else if (choice.value === "directory") {
        await addDirectory(sources, provider, watcherManager, updateMessage);
      } else {
        await addFile(sources, provider, watcherManager, updateMessage);
      }
    })
  );
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Terminal runner
// ---------------------------------------------------------------------------

function openInSystemTerminal(cwd: string, command: string) {
  const escaped = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const fullCmd = cwd ? `cd "${escaped(cwd)}" && ${command}` : command;

  if (process.platform === "darwin") {
    const app = (vscode.workspace.getConfiguration("runway").get<string>("systemTerminalApp") ?? "Terminal").trim();
    const appLower = app.toLowerCase();

    if (appLower === "warp") {
      // Write a self-deleting temp script and open it in Warp
      const tmpFile = `/tmp/runway_${Date.now()}.sh`;
      fs.writeFileSync(tmpFile, `#!/bin/zsh\n${fullCmd}\nrm -- "$0"\n`, { mode: 0o755 });
      exec(`open -a Warp "${tmpFile}"`);

    } else if (appLower === "iterm" || appLower === "iterm2") {
      const safeCmd = fullCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `tell application "iTerm2"
  create window with default profile command "bash -c \\"${safeCmd}; exec bash\\""
  activate
end tell`;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

    } else {
      // Terminal.app (default) and any other app via AppleScript do script
      const safeCmd = fullCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `tell application "${app}"
  do script "${safeCmd}"
  activate
end tell`;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    }

  } else if (process.platform === "win32") {
    exec(`start cmd /K "${escaped(fullCmd)}"`);

  } else {
    // Linux: try common terminal emulators in order of preference
    const emulators = [
      `gnome-terminal -- bash -c "${escaped(fullCmd)}; exec bash"`,
      `xterm -e bash -c "${escaped(fullCmd)}; exec bash"`,
      `konsole -e bash -c "${escaped(fullCmd)}; exec bash"`,
    ];
    (function tryNext(i: number) {
      if (i >= emulators.length) return;
      exec(emulators[i], (err) => { if (err) tryNext(i + 1); });
    })(0);
  }
}

function runInTerminal(
  script: Script,
  command: string,
  onStart: ((name: string) => void) | undefined,
  pendingCommands: Map<string, string>,
  trackedExecutions: Map<string, vscode.TerminalShellExecution>
) {
  const existing = vscode.window.terminals.find(t => t.name === script.label);

  if (existing) {
    existing.show();
    if (existing.shellIntegration) {
      // Shell integration already active — interrupt anything running then re-execute
      existing.sendText("\x03");
      setTimeout(() => {
        const execution = existing.shellIntegration!.executeCommand(command);
        trackedExecutions.set(existing.name, execution);
        onStart?.(existing.name);
      }, 100);
    } else {
      // No shell integration on this terminal — queue for when it activates,
      // with a fallback to sendText after 3 s.
      existing.sendText("\x03");
      pendingCommands.set(existing.name, command);
      setTimeout(() => {
        if (pendingCommands.get(existing.name) === command) {
          pendingCommands.delete(existing.name);
          existing.sendText(command);
        }
        onStart?.(existing.name);
      }, 3000);
    }
  } else {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const terminal = vscode.window.createTerminal({
      name: script.label,
      cwd: script.cwd,
      shellPath: shell,
    });
    terminal.show();
    // Queue the command — onDidChangeTerminalShellIntegration will execute it.
    // Fall back to sendText after 3 s if shell integration never activates.
    pendingCommands.set(script.label, command);
    setTimeout(() => {
      if (pendingCommands.get(script.label) === command) {
        pendingCommands.delete(script.label);
        terminal.sendText(command);
      }
      // onDidOpenTerminal already called markRunning for new terminals
    }, 3000);
  }
}

// ---------------------------------------------------------------------------
// Add sources
// ---------------------------------------------------------------------------

async function addPackageJson(
  sources: SourceStore,
  provider: ScriptProvider,
  watcherManager: WatcherManager,
  updateMessage: () => void
) {
  const wsRoot = vscode.workspace.workspaceFolders?.[0].uri;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    defaultUri: wsRoot,
    openLabel: "Add package.json",
    filters: { "package.json": ["json"] },
  });
  if (!picked?.length) return;

  let added = 0;
  for (const uri of picked) {
    const absPath = uri.fsPath;
    if (path.basename(absPath) !== "package.json") {
      vscode.window.showWarningMessage(`Skipped ${path.basename(absPath)} — only package.json files are supported here.`);
      continue;
    }
    if (await sources.add({ type: "packageJson", path: absPath })) added++;
  }

  if (added > 0) {
    watcherManager.sync();
    provider.refresh();
    updateMessage();
  }
}

async function addDirectory(
  sources: SourceStore,
  provider: ScriptProvider,
  watcherManager: WatcherManager,
  updateMessage: () => void
) {
  const wsRoot = vscode.workspace.workspaceFolders?.[0].uri;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    defaultUri: wsRoot,
    openLabel: "Add Directory",
  });
  if (!picked?.length) return;

  let added = 0;
  for (const uri of picked) {
    if (await sources.add({ type: "directory", path: uri.fsPath })) added++;
  }

  if (added > 0) {
    watcherManager.sync();
    provider.refresh();
    updateMessage();
  }
}

async function addFile(
  sources: SourceStore,
  provider: ScriptProvider,
  watcherManager: WatcherManager,
  updateMessage: () => void
) {
  const wsRoot = vscode.workspace.workspaceFolders?.[0].uri;

  const allExts = FILE_SCRIPT_TYPES.flatMap((t) => t.extensions.map((e) => e.slice(1)));
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    defaultUri: wsRoot,
    openLabel: "Add Script File",
    filters: { "Script files": allExts },
  });
  if (!picked?.length) return;

  let added = 0;
  for (const uri of picked) {
    const ext = path.extname(uri.fsPath);
    if (!EXT_TO_TYPE.has(ext)) {
      vscode.window.showWarningMessage(`Unsupported file type: ${ext}`);
      continue;
    }
    if (await sources.add({ type: "file", path: uri.fsPath })) added++;
  }

  if (added > 0) {
    watcherManager.sync();
    provider.refresh();
    updateMessage();
  }
}
