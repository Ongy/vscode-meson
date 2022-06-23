import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import * as vscode from "vscode";
import { createHash, BinaryLike } from "crypto";
import { Target } from "./meson/types";
import { ExtensionConfiguration } from "./types";
import { getMesonBuildOptions, getMesonTargets } from "./meson/introspection";
import { extensionPath } from "./extension";

export async function exec(
  command: string,
  args: string[],
  options: cp.ExecOptions = {}
): Promise<{ stdout: string; stderr: string, error?: cp.ExecException }> {
  return new Promise<{ stdout: string; stderr: string, error?: cp.ExecException }>((resolve, reject) => {
    cp.execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function execStream(
  command: string,
  args: string[],
  options: cp.SpawnOptions
) {
  const spawned = cp.spawn(command, args, options);
  return {
    onLine(fn: (line: string, isError: boolean) => void) {
      spawned.stdout.on("data", (msg: Buffer) => fn(msg.toString(), false));
      spawned.stderr.on("data", (msg: Buffer) => fn(msg.toString(), true));
    },
    kill(signal?: NodeJS.Signals) {
      spawned.kill(signal || "SIGKILL");
    },
    finishP() {
      return new Promise<number>(res => {
        spawned.on("exit", code => res(code));
      });
    }
  };
}

export async function execFeed(
  command: string,
  args: string[],
  options: cp.ExecOptions = {},
  stdin: string
): Promise<{ stdout: string; stderr: string, error?: cp.ExecFileException }> {
  return new Promise<{ stdout: string; stderr: string, error?: cp.ExecFileException }>(resolve => {
    let p = cp.execFile(command, args, options, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error ? error : undefined });
    });

    p.stdin?.write(stdin);
    p.stdin?.end();
  });
}

export function execAsTask(
  command: string,
  args: string[],
  options: vscode.ProcessExecutionOptions,
  revealMode = vscode.TaskRevealKind.Silent
) {
  const task = new vscode.Task(
    { type: "temp" },
    command,
    "Meson",
    new vscode.ProcessExecution(command, args, options)
  );
  task.presentationOptions.echo = false;
  task.presentationOptions.focus = false;
  task.presentationOptions.reveal = revealMode;
  return vscode.tasks.executeTask(task);
}

export async function parseJSONFileIfExists<T = object>(path: string) {
  try {
    const data = await fs.promises.readFile(path);
    return JSON.parse(data.toString()) as T;
  }
  catch (err) {
    return false;
  }
}

let _channel: vscode.OutputChannel;
export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("Meson Build");
  }
  return _channel;
}

export function extensionRelative(filepath: string) {
  return path.join(extensionPath, filepath);
}

export function workspaceRelative(filepath: string) {
  return path.resolve(vscode.workspace.rootPath, filepath);
}

/** Gets the target name as used by meson calls to pick the target
 * 
 * This differs from `target.name`. The return value from this function
 * can be passed to meson. It contians an internal path from the build
 * system as well.
 * 
 * @param target The target to get the name off
 * @returns The target name that can be passed to meson calls
 */
export async function getTargetName(target: Target) {
  const buildDir = path.resolve(target.workspace.uri.fsPath, extensionConfiguration("buildFolder"));
  const buildOptions = await getMesonBuildOptions(buildDir);
  const layoutOption = buildOptions.filter(o => o.name === "layout")[0];

  if (layoutOption.value === "mirror") {
    const relativePath = path.relative(target.workspace.uri.fsPath, path.dirname(target.defined_in));

    // Meson requires the separator between path and target name to be '/'.
    return path.posix.join(relativePath, target.name);
  }
  else {
    return `meson-out/${target.name}`;
  }
}

export function hash(input: BinaryLike) {
  const hashObj = createHash("sha1");
  hashObj.update(input);
  return hashObj.digest("hex");
}

export function getConfiguration() {
  return vscode.workspace.getConfiguration("mesonbuild");
}

export function extensionConfiguration<K extends keyof ExtensionConfiguration>(
  key: K
) {
  return getConfiguration().get<ExtensionConfiguration[K]>(key);
}

export function extensionConfigurationSet<
  K extends keyof ExtensionConfiguration
>(
  key: K,
  value: ExtensionConfiguration[K],
  target = vscode.ConfigurationTarget.Global
) {
  return getConfiguration().update(key, value, target);
}

export function arrayIncludes<T>(array: T[], value: T) {
  return array.indexOf(value) !== -1;
}

export function isThenable<T>(x: vscode.ProviderResult<T>): x is Thenable<T> {
  return arrayIncludes(Object.getOwnPropertyNames(x), "then");
}

/** Does the same as `getMesonTargets` but makes sure the workspace attribute is set
 * 
 * @param folder The workspace folder to get the targets for
 * @returns A list of targets defined in the workspace
 */
export async function getMesonTargetsFromFolder(folder: vscode.WorkspaceFolder) {
    const buildDir = path.resolve(folder.uri.fsPath, extensionConfiguration("buildFolder"))

    let ret = await getMesonTargets(buildDir);
    for (let target of ret) {
      target.workspace = folder;
    }

    return ret;
}