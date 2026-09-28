import { invoke } from "@tauri-apps/api/core";

export interface TreeNode {
  path: string;
  kind: "folder" | "file";
}

export interface Selection {
  kind: "folder" | "file";
  path: string;
}

export interface WorkspaceSession {
  selection: Selection | null;
  warnings: string[];
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const host = {
  session: () => invoke<WorkspaceSession>("session"),
  rememberSelection: (kind: Selection["kind"], path: string) =>
    invoke<void>("remember_selection", { kind, path }),
  listTree: () => invoke<TreeNode[]>("list_tree"),
  createFolder: (parent: string, name: string) => invoke<string>("create_folder", { parent, name }),
  createFile: (parent: string, name: string) => invoke<string>("create_file", { parent, name }),
  readText: (relativePath: string) => invoke<string>("read_text", { relativePath }),
  writeText: (relativePath: string, content: string) =>
    invoke<void>("write_text", { relativePath, content }),
  removePath: (relativePath: string) => invoke<void>("remove_path", { relativePath }),
  renamePath: (from: string, name: string) => invoke<string>("rename_path", { from, name }),
  importMarkdown: (parent: string) => invoke<string[]>("import_markdown", { parent }),
  exportText: (defaultName: string, content: string) =>
    invoke<boolean>("export_text", { defaultName, content }),
};
