import * as vscode from "vscode";
import {
  exec,
  extensionConfiguration,
} from "./utils";
import {
    Tests
} from "./meson/types"
import {
    getMesonTests,
    getMesonTargets,
    getMesonProjectInfo
} from "./meson/introspection"
import path = require("path");
import { existsSync } from "fs";


async function rebuildTestsForFolder(controller: vscode.TestController, collection: vscode.TestItemCollection, folder: vscode.WorkspaceFolder) {
    let tests = await getMesonTests(path.resolve(folder.uri.fsPath, extensionConfiguration("buildFolder")))

    collection.forEach(item => {
      if (!tests.some(test => item.id == test.name)) {
        collection.delete(item.id);
      }
    });

    for (let testDescr of tests) {
      let testItem = controller.createTestItem(testDescr.name, testDescr.name, folder.uri)
      collection.add(testItem)
    }
}

export async function rebuildTests(controller: vscode.TestController) {
    if (vscode.workspace.workspaceFolders.length == 1) {
        rebuildTestsForFolder(controller, controller.items, vscode.workspace.workspaceFolders[0])
    } else {
        for (const wsFolder of vscode.workspace.workspaceFolders) {
            const buildDir = path.resolve(wsFolder.uri.fsPath, extensionConfiguration("buildFolder"));
            if (!existsSync(buildDir)) {
                let item = controller.items.get(wsFolder.uri.fsPath);
                if (item != undefined) {
                    controller.items.delete(item.id);
                }
                continue;
            }

            try {
                const info = await getMesonProjectInfo(buildDir);

                let item = controller.items.get(wsFolder.uri.fsPath);
                if (item == undefined) {
                    item = controller.createTestItem(wsFolder.uri.path, info.descriptive_name);
                    controller.items.add(item);
                }

                await rebuildTestsForFolder(controller, item.children, wsFolder);
            } catch {
                vscode.window.showErrorMessage(`Failed to get tests for folder ${wsFolder.name}`);
            }
        }

        controller.items.forEach((item: vscode.TestItem) => {
            if (item.children.size == 0) {
                controller.items.delete(item.id);
            } else if (!vscode.workspace.workspaceFolders.some((wsFolder: vscode.WorkspaceFolder) => {
                return wsFolder.uri.path == item.id;
            })) {
                console.log(`Removing item with ${item.id} becuase it's not referenced`)
                controller.items.delete(item.id);
            }
        });
    }
}

function addTests(queue: vscode.TestItem[], tests: readonly vscode.TestItem[] | vscode.TestItemCollection) {
    tests.forEach((test: vscode.TestItem) => {
        queue.push(test);
        addTests(queue, test.children);
    });
}

export async function testRunHandler(controller: vscode.TestController, request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const run = controller.createTestRun(request, null, false);
    const queue: vscode.TestItem[] = [];

    addTests(queue, request.include ?? controller.items)

    for (let test of queue) {

        run.started(test);
        /* The way our tests are structred, they *either* have children, or can be run */
        if (test.children.size > 0) {
            run.passed(test);
            continue;
        }

        let starttime = Date.now();
        try {
            await exec(extensionConfiguration("mesonPath"), ['test', '-C', path.resolve(test.uri.fsPath, extensionConfiguration("buildFolder")), '--print-errorlog', test.id]);
            let duration = Date.now() - starttime;
            run.passed(test, duration);
        } catch (e) {
            run.appendOutput(e.stdout);
            let duration = Date.now() - starttime;
            if (e.error.code == 125) {
                vscode.window.showErrorMessage("Failed to build tests. Results will not be updated");
                run.errored(test, new vscode.TestMessage(e.stderr));
            } else {
                run.failed(test, new vscode.TestMessage(e.stderr), duration);
            }
        }
    }

    run.end();
}

async function prepareTestInFolder(queue: readonly vscode.TestItem[], wsFolder: vscode.WorkspaceFolder) {
    const buildDir = path.resolve(wsFolder.uri.fsPath, extensionConfiguration("buildFolder"))
    const tests: Tests = await getMesonTests(buildDir);
    const targets = await getMesonTargets(buildDir);

    /* while meson has the --gdb arg to test, but IMO we should go the actual debugger route.
    * We still want stuff to be built though... Without going through weird dances */
    const relevantTests = tests.filter(test => queue.some(candidate => candidate.id == test.name));
    const requiredTargets = targets.filter(target => relevantTests.some(test => test.depends.some(dep => dep == target.id)));

    if (requiredTargets.length == 0) {
        return [];
    }

    var args = ['compile', '-C', buildDir]
    requiredTargets.forEach(target => {
        args.push(target.name);
    });

    try {
        await exec(extensionConfiguration("mesonPath"), args);
    } catch(e) {
        vscode.window.showErrorMessage(`Failed to build tests in ${wsFolder.name}. Results will not be updated`);
        return [];
    }

    let configDebugOptions = extensionConfiguration("debugOptions")
    return relevantTests.map(test => {
        let args = [...test.cmd]
        args.shift();
        let debugConfiguration = {
                name: `meson-debug-${test.name}`,
                type: "cppdbg",
                request: "launch",
                cwd: test.workdir || buildDir,
                env: test.env,
                program: test.cmd[0],
                args: args,
            };
        return {folder: wsFolder,
                config: {...debugConfiguration, ...configDebugOptions}};
        });
}

export async function testDebugHandler(controller: vscode.TestController, request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const run = controller.createTestRun(request, null, false);
    const queue: vscode.TestItem[] = [];

    addTests(queue, request.include ?? controller.items)

    let debugConfigs = [];
    for (const wsFolder of vscode.workspace.workspaceFolders) {
        if (queue.some((test: vscode.TestItem) => test.uri == wsFolder.uri)) {
            debugConfigs = debugConfigs.concat(await prepareTestInFolder(queue, wsFolder));
        }
    }

    for (const debugConfig of debugConfigs) {
        await vscode.debug.startDebugging(debugConfig.folder, debugConfig.config);
    }

    run.end();
}