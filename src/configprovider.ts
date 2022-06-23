import path = require("path");
import * as vscode from "vscode";

import {
    getMesonTargets
} from "./meson/introspection"
import {
    extensionConfiguration,
    getMesonTargetsFromFolder,
    getTargetName
} from "./utils"

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor() { }

    async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration[]> {
        /* TODO: Figure out if this should iterate over all, or we are called with every folder */
        let targets = await getMesonTargetsFromFolder(folder ?? vscode.workspace.workspaceFolders[0]);

        let configDebugOptions = extensionConfiguration("debugOptions");

        const executables = targets.filter(target => target.type == "executable");
        let ret: vscode.DebugConfiguration[] = [];

        for (const target of executables) {
            if (!target.target_sources.some(source => ['cpp', 'c'].includes(source.language))) {
                continue;
            }

            const targetName = await getTargetName(target)
            let debugConfiguration = {
                type: 'cppdbg',
                name: target.name,
                request: "launch",
                cwd: path.resolve(target.workspace.uri.fsPath, extensionConfiguration("buildFolder")),
                program: target.filename[0],
                preLaunchTask: `Meson: Build ${targetName}`
            };
            ret.push({...configDebugOptions, ...debugConfiguration})
        }

        return ret;
    }

    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        return debugConfiguration
    }

    resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        return debugConfiguration
    }

}