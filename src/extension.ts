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
  makeCommand: (filename: string) => string;
  boilerplate: string;
}

const FILE_SCRIPT_TYPES: FileScriptType[] = [
  {
    kind: "shell", label: "Shell Scripts",
    extensions: [".sh", ".bash", ".zsh"], iconFile: "shell.svg",
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
  private static readonly KEY = "scriptRunner.sources";
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

function detectPM(pkgDir: string): PM {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    if (typeof pkg.packageManager === "string") {
      if (pkg.packageManager.startsWith("pnpm")) return "pnpm";
      if (pkg.packageManager.startsWith("yarn")) return "yarn";
      if (pkg.packageManager.startsWith("bun")) return "bun";
    }
  } catch { /* ignore */ }

  if (fs.existsSync(path.join(pkgDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(pkgDir, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(pkgDir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(pkgDir, "package-lock.json"))) return "npm";

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
    labels: ScriptStore
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
        this.contextValue = isOverridden ? "runnable-overridden" : "runnable";
        this.iconPath = new vscode.ThemeIcon(isOverridden ? "wrench" : "play");
        if (!customLabel) this.description = effectiveCommand;
        this.tooltip = isOverridden
          ? `Override: ${override}\nDefault: ${script.defaultCommand}`
          : script.defaultCommand;
        this.command = { command: "scriptRunner.run", title: "Run", arguments: [script, effectiveCommand] };
        break;

      case "makeTarget":
        this.contextValue = isOverridden ? "runnable-overridden" : "runnable";
        this.iconPath = new vscode.ThemeIcon(isOverridden ? "wrench" : "symbol-method");
        if (!customLabel) this.description = effectiveCommand;
        this.tooltip = isOverridden
          ? `Override: ${override}\nDefault: ${script.defaultCommand}`
          : script.defaultCommand;
        this.command = { command: "scriptRunner.run", title: "Run", arguments: [script, effectiveCommand] };
        break;

      case "fileScript":
        this.contextValue = isOverridden ? "runnable-overridden" : "runnable";
        this.resourceUri = vscode.Uri.file(script.filePath!);
        if (isOverridden) this.iconPath = new vscode.ThemeIcon("wrench");
        if (!customLabel && isOverridden) this.description = override;
        this.tooltip = isOverridden
          ? `Override: ${override}\nDefault: ${script.defaultCommand}`
          : script.filePath;
        this.command = { command: "scriptRunner.run", title: "Run", arguments: [script, effectiveCommand] };
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
    private readonly labels: ScriptStore
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
    });
  }

  // -- Helper --------------------------------------------------------------

  private item(script: Script): ScriptItem {
    return new ScriptItem(script, this.extensionUri, this.overrides, this.labels);
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  const sources = new SourceStore(context.workspaceState);
  const overrides = new ScriptStore(context.workspaceState, "scriptRunner.overrides");
  const labels = new ScriptStore(context.workspaceState, "scriptRunner.labels");
  const provider = new ScriptProvider(context.extensionUri, sources, overrides, labels);

  const treeView = vscode.window.createTreeView("scriptRunnerView", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // Show welcome message when no sources are added
  function updateMessage() {
    treeView.message = sources.getAll().length === 0
      ? "No scripts added yet. Click + to add a package.json, directory, or script file."
      : undefined;
  }
  updateMessage();

  context.subscriptions.push(
    treeView,

    vscode.commands.registerCommand("scriptRunner.refresh", () => {
      provider.refresh();
      updateMessage();
    }),

    vscode.commands.registerCommand(
      "scriptRunner.run",
      (script: Script, effectiveCommand: string) => runInTerminal(script, effectiveCommand)
    ),

    vscode.commands.registerCommand(
      "scriptRunner.setOverride",
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
      "scriptRunner.clearOverride",
      async (item: ScriptItem) => {
        if (!item.script.id) return;
        await overrides.clear(item.script.id);
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "scriptRunner.setLabel",
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
      "scriptRunner.clearLabel",
      async (item: ScriptItem) => {
        if (!item.script.id) return;
        await labels.clear(item.script.id);
        provider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "scriptRunner.removeSource",
      async (item: ScriptItem) => {
        const src = item.script.sourcePath ?? item.script.filePath;
        if (!src) return;
        await sources.remove(src);
        provider.refresh();
        updateMessage();
      }
    ),

    vscode.commands.registerCommand(
      "scriptRunner.manageSources",
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
        provider.refresh();
        updateMessage();
      }
    ),

    vscode.commands.registerCommand("scriptRunner.add", async () => {
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
        await vscode.commands.executeCommand("scriptRunner.manageSources");
        return;
      }

      if (choice.value === "packageJson") {
        await addPackageJson(sources, provider, updateMessage);
      } else if (choice.value === "directory") {
        await addDirectory(sources, provider, updateMessage);
      } else {
        await addFile(sources, provider, updateMessage);
      }
    })
  );
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Terminal runner
// ---------------------------------------------------------------------------

function runInTerminal(script: Script, command: string) {
  const terminal = vscode.window.createTerminal({ name: script.label, cwd: script.cwd });
  terminal.show();
  terminal.sendText(command);
}

// ---------------------------------------------------------------------------
// Add sources
// ---------------------------------------------------------------------------

async function addPackageJson(
  sources: SourceStore,
  provider: ScriptProvider,
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
    provider.refresh();
    updateMessage();
  }
}

async function addDirectory(
  sources: SourceStore,
  provider: ScriptProvider,
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
    provider.refresh();
    updateMessage();
  }
}

async function addFile(
  sources: SourceStore,
  provider: ScriptProvider,
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
    provider.refresh();
    updateMessage();
  }
}
