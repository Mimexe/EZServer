import Debug from "debug";
import cp from "child_process";
import fs from "fs";
import { downloadFile, getDownloadURL } from "./DownloadUtils.js";
import { APIUrl, ServerType } from "./types.js";
import path from "path";
import ora, { Ora } from "ora";
import axios from "axios";
const debug = Debug("ezserver:cli-core");

export async function create(
  name: string,
  type: ServerType,
  version: string,
  options: CreateOptions
) {
  let hasJava = false;
  debug(
    "Creating server %s of type %s with version %s and options %O",
    name,
    type,
    version,
    options
  );
  if (!options.dir) throw new Error("Directory not provided.");
  if (!options.port) throw new Error("Port not provided.");
  if (!options.javapath || !fs.existsSync(options.javapath)) {
    debug("Java path not provided or innexistent.");
  } else {
    hasJava = true;
  }
  if (
    options.includePlugins &&
    type !== ServerType.SPIGOT &&
    type !== ServerType.PAPER
  ) {
    throw new Error("Plugins can only be included with Spigot/Paper servers.");
  }
  debug("Creating server...");
  fs.mkdirSync(options.dir, { recursive: true });
  fs.writeFileSync(
    path.join(options.dir, "server.properties"),
    `server-port=${options.port}`
  );
  fs.writeFileSync(path.join(options.dir, "eula.txt"), "eula=true");
  debug("Checking for server type %s...", type);
  switch (type) {
    case ServerType.VANILLA:
      debug("Creating Vanilla server...");
      await downloadFile(
        await getDownloadURL(version, type),
        options.dir + "/server.jar"
      );
      break;
    case ServerType.SPIGOT:
      debug("Creating Spigot server...");
      if (!hasJava) {
        throw new Error("To create a spigot server, you need java.");
      }
      // Use BuildTools to build the server
      fs.mkdirSync(options.dir + "/buildtools", { recursive: true });
      await downloadFile(
        "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar",
        options.dir + "/buildtools/buildtools.jar"
      );
      // Run BuildTools
      const isSuccess = await new Promise<boolean>((resolve, reject) => {
        const debugTools = Debug("ezserver:buildtools");
        let spinner: Ora | null = ora("Running BuildTools...");
        if (debugTools.enabled) spinner = null;
        debugTools("Running BuildTools...");
        const child = cp.spawn(
          path.join(options.javapath, "bin", "java"),
          ["-jar", "buildtools.jar", "--rev", version],
          { cwd: options.dir + "/buildtools" }
        );
        child.on("spawn", () => {
          debugTools("BuildTools started.");
          if (spinner) spinner.start();
        });
        child.stdout.on("data", (data) => {
          const str: string = data.toString().trim();
          if (spinner) spinner.text = str.split("\n").pop() || str;
          debugTools(str);
        });
        child.stderr.on("data", (data) => {
          debugTools(data.toString().trim());
        });
        child.on("close", (code) => {
          debugTools("BuildTools exited with code %d", code);
          if (code !== 0) {
            if (spinner) spinner.fail("BuildTools failed.");
          } else {
            if (spinner) spinner.succeed("BuildTools finished.");
          }

          resolve(code === 0);
        });
        child.on("error", (e) => {
          debugTools("BuildTools error: %s", e.message);
          if (spinner) spinner.fail("BuildTools failed.");
          resolve(false);
        });
      });
      debug("BuildTools %s", isSuccess);
      if (!isSuccess) {
        debug("BuildTools failed.");
        throw new Error("BuildTools failed.");
      }
      // Move the server jar
      const buildtoolsDir = options.dir + "/buildtools";
      const files = fs.readdirSync(buildtoolsDir);
      const spigotJar = files.find(
        (file) => file.startsWith("spigot-") && file.endsWith(".jar")
      );
      if (spigotJar) {
        fs.renameSync(
          path.join(buildtoolsDir, spigotJar),
          path.join(options.dir, "server.jar")
        );
      } else {
        throw new Error("Spigot JAR not found.");
      }
      // Delete the buildtools folder
      const spinner = ora("Deleting BuildTools folder...").start();
      fs.rmSync(options.dir + "/buildtools", { recursive: true });
      spinner.succeed("BuildTools folder deleted.");
      // Download plugins
      if (options.includePlugins) {
        // TODO: Implement plugin download
      }
      break;
    case ServerType.PAPER:
      debug("Creating Paper server...");
      // Download the server jar
      await downloadFile(
        await getDownloadURL(version, type),
        options.dir + "/server.jar"
      );
      // Download plugins
      if (options.includePlugins) {
        // TODO: Implement plugin download
      }

      break;
    case ServerType.FORGE:
      debug("Creating Forge server...");
      // await createForgeServer();
      break;
    case ServerType.FABRIC:
      debug("Creating Fabric server...");
      // await createFabricServer();
      break;
    default:
      throw new Error("Invalid server type.");
  }
  debug("Server created.");
}

export async function runServer(dir: string, javaPath: string) {
  if (!javaPath) {
    throw new Error("You need Java to run the server.");
  }
  return new Promise<void>((resolve) => {
    const debugServer = Debug("ezserver:run");
    let spinner: Ora | null = ora("Starting server...");
    if (debugServer.enabled) spinner = null;
    const child = cp.spawn(
      path.join(javaPath, "bin", "java"),
      ["-jar", "server.jar", "nogui"],
      { cwd: dir }
    );
    const regex = /.*Done \(\d+\.\d{3}s\)! For help, type "help"/;
    child.on("spawn", () => {
      debugServer("Server started.");
      if (spinner) spinner.start();
    });
    child.stdout.on("data", (data) => {
      if (regex.test(data.toString().trim())) {
        debugServer("Server started. Sending stop command.");
        setTimeout(() => {
          child.stdin.write("stop\n");
        }, 5000);
      }
      debugServer(data.toString().trim());
      if (spinner) spinner.text = data.toString().trim();
    });
    child.stderr.on("data", (data) => {
      debugServer(data.toString().trim());
      if (spinner) spinner.text = data.toString().trim();
    });
    child.on("exit", () => {
      debugServer("Server exited.");
    });
    child.on("close", (code) => {
      debugServer("Server exited with code %d", code);
      if (spinner) spinner.succeed("Server stopped.");
      resolve();
    });
    child.on("error", () => {
      if (spinner) spinner.fail("Server failed to start.");
      resolve();
    });
  });
}

export type CreateOptions = {
  dir: string;
  includePlugins?: boolean;
  port: string;
  javapath: string;
};

export default {
  create,
  runServer,
};
