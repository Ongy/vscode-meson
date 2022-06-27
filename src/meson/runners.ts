import * as vscode from "vscode";
import {
  exec,
  execAsTask,
  getOutputChannel,
  extensionConfiguration,
  execStream
} from "../utils";
import { getTask } from "../tasks";
import { relative } from "path";
import { checkMesonIsConfigured } from "./utils";

/** Run meson configure to ensure we have a builddir generated from the source
 *
 * @param source The root directory of the project
 * @param build The build directory name inside the source root
 */
export async function runMesonConfigure(source: string, build: string) {
  return vscode.window.withProgress(
    {
      title: "Configuring",
      location: vscode.ProgressLocation.Notification,
      cancellable: false
    },
    async progress => {
      progress.report({
        message: `Checking if Meson is configured in ${relative(
          source,
          build
        )}...`
      });

      const configureOpts = extensionConfiguration("configureOptions");

      if (await checkMesonIsConfigured(build)) {
        progress.report({
          message: "Applying configure options...",
          increment: 30
        });

        await exec(
          extensionConfiguration("mesonPath"), ["configure", ...configureOpts, build],
          { cwd: source }
        );
        progress.report({ message: "Reconfiguring build...", increment: 60 });

        // Note "setup --reconfigure" needs to be run from the root.
        await exec(extensionConfiguration("mesonPath"), ["setup", "--reconfigure", build],
          { cwd: source });
      } else {
        progress.report({
          message: `Configuring Meson into ${relative(source, build)}...`
        });

        const { stdout, stderr } = await exec(
          extensionConfiguration("mesonPath"), ["setup", ...configureOpts, build],
          { cwd: source });

        getOutputChannel().appendLine(stdout);
        getOutputChannel().appendLine(stderr);

        if (stderr.length > 0) {
          getOutputChannel().show(true);
        }
      }
      progress.report({ message: "Done.", increment: 100 });
      return new Promise(res => setTimeout(res, 2000));
    }
  );
}

export async function runMesonReconfigure() {
  try {
    await vscode.tasks.executeTask(await getTask("reconfigure"));
  } catch (e) {
    vscode.window.showErrorMessage("Could not reconfigure project.");
    getOutputChannel().appendLine("Reconfiguring Meson:");
    getOutputChannel().appendLine(e);
    getOutputChannel().show(true);
  }
}

/** Run the build command and have meson take care of scheduling
 * 
 * @param buildDir The build directory to run meson in
 * @param name The target to build. Or null to build every possible target
 */
export async function runMesonBuild(buildDir: string, name?: string) {

  try {
    await vscode.tasks.executeTask(await getTask("build", name));
  } catch (e) {
    vscode.window.showErrorMessage(`Could not build ${name}`);
    getOutputChannel().appendLine(`Building target ${name}:`);
    getOutputChannel().appendLine(e);
    getOutputChannel().show(true);
  }

  return;
}

export async function runMesonTests(buildDir: string, isBenchmark: boolean, name?: string) {
  try {
    const benchmarkArgs = isBenchmark ? ["--benchmark", "--verbose"] : [];
    const args = ["test", ...benchmarkArgs].concat(name ?? []);
    return await execAsTask(
      extensionConfiguration("mesonPath"), args,
      { cwd: buildDir },
      vscode.TaskRevealKind.Always
    );
  } catch (e) {
    if (e.stderr) {
      vscode.window.showErrorMessage(`${isBenchmark ? "Benchmarks" : "Tests"} failed.`);
    }
  }
}
