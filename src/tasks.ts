import { existsSync } from "fs";
import path = require("path");
import * as vscode from "vscode";
import {
  getMesonTargets,
  getMesonTests,
  getMesonBenchmarks
} from "./meson/introspection";
import { extensionConfiguration, getMesonTargetsFromFolder, getOutputChannel, getTargetName } from "./utils";

interface MesonTaskDefinition extends vscode.TaskDefinition {
  type: "meson";
  target?: string;
  mode?: "build" | "run" | "test" | "benchmark" | "clean" | "reconfigure";
  filename?: string;
}

export async function getMesonTasksForDir(buildDir: string, workspace: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
  try {
    const [targets, tests, benchmarks] = await Promise.all([
      getMesonTargetsFromFolder(workspace),
      getMesonTests(buildDir),
      getMesonBenchmarks(buildDir)
    ]);
    const defaultBuildTask = new vscode.Task(
      { type: "meson", mode: "build" },
      workspace,
      "Build all targets",
      "Meson",
      new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["compile"], { cwd: buildDir })
    );
    const defaultTestTask = new vscode.Task(
      { type: "meson", mode: "test" },
      workspace,
      "Run tests",
      "Meson",
      new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["test"], { cwd: buildDir })
    );
    const defaultBenchmarkTask = new vscode.Task(
      { type: "meson", mode: "benchmark" },
      workspace,
      "Run benchmarks",
      "Meson",
      new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["test", "--benchmark", "--verbose"], { cwd: buildDir })
    );
    const defaultReconfigureTask = new vscode.Task(
      { type: "meson", mode: "reconfigure" },
      workspace,
      "Reconfigure",
      "Meson",
      // Note "setup --reconfigure" needs to be run from the root.
      new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["setup", "--reconfigure", buildDir],
        { cwd: workspace.uri.fsPath })
    );
    const defaultCleanTask = new vscode.Task(
      { type: "meson", mode: "clean" },
      workspace,
      "Clean",
      "Meson",
      new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["compile", "--clean"], { cwd: buildDir })
    );
    defaultBuildTask.group = vscode.TaskGroup.Build;
    defaultTestTask.group = vscode.TaskGroup.Test;
    defaultBenchmarkTask.group = vscode.TaskGroup.Test;
    defaultReconfigureTask.group = vscode.TaskGroup.Rebuild;
    defaultCleanTask.group = vscode.TaskGroup.Clean;
    const tasks = [
      defaultBuildTask,
      defaultTestTask,
      defaultBenchmarkTask,
      defaultReconfigureTask,
      defaultCleanTask
    ];
    tasks.push(
      ...(await Promise.all(
        targets.map(async t => {
          const targetName = await getTargetName(t);
          const def: MesonTaskDefinition = {
            type: "meson",
            target: targetName,
            mode: "build"
          };
          const buildTask = new vscode.Task(
            def,
            workspace,
            `Build ${targetName}`,
            "Meson",
            new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["compile", targetName], {
              cwd: buildDir
            })
          );
          buildTask.group = vscode.TaskGroup.Build;
          if (t.type == "executable") {
            if (t.filename.length == 1) {
              const runTask = new vscode.Task(
                { type: "meson", target: targetName, mode: "run" },
                workspace,
                `Run ${targetName}`,
                "Meson",
                new vscode.ProcessExecution(t.filename[0])
              );
              runTask.group = vscode.TaskGroup.Test;
              return [buildTask, runTask];
            } else {
              const runTasks = t.filename.map(f => {
                const runTask = new vscode.Task(
                  {
                    type: "meson",
                    target: targetName,
                    filename: f,
                    mode: "run"
                  },
                  workspace,
                  `Run ${targetName}: ${f}`,
                  "Meson",
                  new vscode.ProcessExecution(f, {
                    cwd: workspace.uri.fsPath
                  })
                );
                runTask.group = vscode.TaskGroup.Test;
                return runTask;
              });
              return [buildTask, ...runTasks];
            }
          }
          return buildTask;
        })
      )).flat(1),
      ...tests.map(t => {
        const testTask = new vscode.Task(
          { type: "meson", mode: "test", target: t.name },
          workspace,
          `Test ${t.name}`,
          "Meson",
          new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["test", t.name], {
            env: t.env,
            cwd: buildDir
          })
        );
        testTask.group = vscode.TaskGroup.Test;
        return testTask;
      }),
      ...benchmarks.map(b => {
        const benchmarkTask = new vscode.Task(
          { type: "meson", mode: "benchmark", target: b.name },
          workspace,
          `Benchmark ${b.name}`,
          "Meson",
          new vscode.ProcessExecution(extensionConfiguration("mesonPath"), ["test", "--benchmark", "--verbose", b.name], {
            env: b.env,
            cwd: buildDir
          })
        );
        benchmarkTask.group = vscode.TaskGroup.Test;
        return benchmarkTask;
      })
    );
    return tasks;
  } catch (e) {
    getOutputChannel().appendLine(e);
    if (e.stderr) getOutputChannel().appendLine(e.stderr);
    vscode.window.showErrorMessage(
      "Could not fetch targets. See Meson Build output tab for more info."
    );

    return [];
  }
}

export async function getMesonTasks(): Promise<vscode.Task[]> {
  let tasks = []
  const buildDir = extensionConfiguration("buildFolder");
  for (const wsFolder of vscode.workspace.workspaceFolders) {
    const wsBuildDir = path.resolve(wsFolder.uri.fsPath, buildDir)
    if (existsSync(wsBuildDir)) {
      tasks.push(await getMesonTasksForDir(wsBuildDir, wsFolder))
    }
  }
  //return path.resolve(vscode.workspace.rootPath, filepath);
  return [].concat(...tasks);
}

export async function getTask(mode: string, name?: string) {
  const tasks = await vscode.tasks.fetchTasks({ type: "meson" });
  const filtered = tasks.filter(
    t => t.definition.mode === mode && (!name || t.definition.target === name)
  );
  if (filtered.length === 0)
    throw new Error(`Cannot find ${mode} target ${name}.`);
  return filtered[0];
}
