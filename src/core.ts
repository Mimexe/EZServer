import Debug from "debug";
import cp from "child_process";
import fs from "fs";
import os from "os";
import {
  downloadFile,
  getDownloadURL,
  getLatestVersion,
} from "./downloadUtils.js";
import { ServerType } from "./types.js";
import path from "path";
import ora, { Ora } from "ora";
import MimeLogger from "mime-logger";
import axios from "axios";
import semver from "semver";
import Enquirer from "enquirer";
const debug = Debug("ezserver:cli-core");
axios.interceptors.request.use((config) => {
  Debug("ezserver:request")(
    "Making request: %s %s",
    config.method?.toUpperCase() || "Unknown",
    config.url || "Unknown"
  );
  return config;
});
const logger = new MimeLogger("Core");

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
    logger.warn("Java path not provided or innexistent.");
  } else {
    hasJava = true;
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
      if (!options.useBuild) {
        debug("Using GetBukkit to download the server.");
        if (version == "latest") {
          throw new Error(
            "Cannot use 'latest' version for Spigot. Please specify a version. Or use -b to use BuildTools."
          );
        }
        await downloadFile(
          "https://download.getbukkit.org/spigot/spigot-" + version + ".jar",
          options.dir + "/server.jar"
        );
      } else {
        debug("Using BuildTools to build the server.");
        if (!hasJava) {
          throw new Error("You need Java to build the server.");
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
            { cwd: options.dir + "/buildtools", shell: true }
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
      }
      break;
    case ServerType.PAPER:
      debug("Creating Paper server...");
      // Download the server jar
      await downloadFile(
        await getDownloadURL(version, type),
        options.dir + "/server.jar"
      );
      break;
    case ServerType.FORGE:
      debug("Creating Forge server...");
      await downloadFile(
        await getDownloadURL(version, type),
        options.dir + "/installer.jar"
      );
      await installForge(options.dir, options.javapath);
      break;
    default:
      throw new Error("Invalid server type.");
  }

  debug("Server created.");
  return true;
}

export async function runServerFirst(
  dir: string,
  javaPath: string,
  type: ServerType
) {
  if (!javaPath) {
    throw new Error("You need Java to run the server.");
  }
  return new Promise<void>((resolve) => {
    const debugServer = Debug("ezserver:run");
    let spinner: Ora | null = ora("Starting server...");
    if (debugServer.enabled) spinner = null;
    let cmd: string;
    let args: string[] = [];
    if (type === ServerType.FORGE) {
      logger.info(
        "Due to possible issues with Forge, it is recommended to run the server manually. You will have access to STDIN"
      );
      const isWindows: boolean = process.platform.indexOf("win") === 0;
      if (isWindows) {
        cmd = "run.bat";
      } else {
        cmd = "run.sh";
      }
    } else {
      cmd = path.join(javaPath, "bin", "java");
      args.push("-Xmx4G", "-jar", "server.jar", "nogui");
    }
    const child = cp.spawn(cmd, args, {
      cwd: dir,
      shell: true,
    });
    if (type === ServerType.FORGE) {
      process.stdin.pipe(child.stdin);
    }
    debug(child.spawnargs);
    const regexDone = /.*Done \(.*\)! For help, type "help"/;
    const regexChunkIO = /.*Flushing Chunk IO/;
    const regexThreadPool = /.*Closing Thread Pool/;
    child.on("spawn", () => {
      debugServer("Server started.");
      if (spinner) spinner.start();
    });
    child.stdout.on("data", (data) => {
      if (regexDone.test(data.toString().trim())) {
        debugServer("Server started. Sending stop command.");
        setTimeout(() => {
          child.stdin.write("stop\n");
        }, 5000);
      } else if (regexChunkIO.test(data.toString().trim())) {
        debug("Detected Chunk IO. Sending stdin due to possible hang.");
        child.stdin.write("a\n");
      } else if (regexThreadPool.test(data.toString().trim())) {
        debug("Detected Thread Pool. Sending stdin due to possible hang.");
        child.stdin.write("a\n");
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

export function hasPluginSupport(type: ServerType) {
  return type === ServerType.SPIGOT || type === ServerType.PAPER;
}

export async function downloadPlugins(
  dir: string,
  version: string,
  type: ServerType
) {
  const listOfPlugins: PluginsArray = [
    {
      name: "EssentialsX",
      type: "github",
      value: "EssentialsX/Essentials:EssentialsX-{latest}.jar",
    },
    {
      name: "spark",
      type: "id",
      value: "57242",
    },
    {
      name: "LuckPerms",
      type: "id",
      value: "28140",
    },
    {
      name: "FastAsyncWorldEdit",
      type: "github",
      value:
        "IntellectualSites/FastAsyncWorldEdit:FastAsyncWorldEdit-Bukkit-{latest}.jar",
    },
    { name: "Vault", type: "id", value: "34315" },
    { name: "DecentHolograms", type: "id", value: "96927" },
    { name: "Skript", type: "id", value: "114544" },
    { name: "PlaceholderAPI", type: "id", value: "6245" },
    { name: "ProtocolLib", type: "id", value: "1997" },
    { name: "Multiverse-Core", type: "id", value: "390" },
  ];
  const mayNotWork: string[] = [];
  const parseAndReplace = async (plugin: PluginsObject) => {
    let url = "";
    if (plugin.type === "id") {
      const { data } = await axios.get(
        `https://api.spiget.org/v2/resources/${plugin.value}`
      );
      const testedVersions = data.testedVersions;
      const currentVersion =
        version == "latest" ? await getLatestVersion(type) : version;
      const ver =
        semver.major(currentVersion) + "." + semver.minor(currentVersion);
      if (!testedVersions.includes(ver)) {
        logger.warn(
          "Plugin %s may not work in version %s. Tested versions: %s",
          plugin.name,
          currentVersion,
          testedVersions.join(", ")
        );
        mayNotWork.push(plugin.name);
      }
      url = `https://api.spiget.org/v2/resources/${plugin.value}/download`;
    } else if (plugin.type === "github") {
      const [repo, file] = plugin.value.split(":");
      debug("Getting latest release for %s and file %s", repo, file);
      const { data } = await axios.get(
        `https://api.github.com/repos/${repo}/releases/latest`
      );
      const tag = data.tag_name;
      debug("Latest tag: %s", tag);
      const fileName = file.replace("{latest}", tag);
      const asset = data.assets.find((asset: any) => asset.name === fileName);
      if (!asset) {
        throw new Error("Asset not found.");
      }
      url = asset.browser_download_url;
    }
    plugin.value = url;
  };
  for (const plugin of listOfPlugins) {
    await parseAndReplace(plugin);
  }
  logger.warn(
    "Some plugins may not work in older versions. Please review them."
  );
  const { selectedPlugins } = await Enquirer.prompt<{
    selectedPlugins: string[];
  }>({
    type: "multiselect",
    name: "selectedPlugins",
    message: "Select the plugins you want to install",
    choices: listOfPlugins.map((plugin) => ({
      name: plugin.name,
      message: `${mayNotWork.includes(plugin.name) ? "⚠️ " : ""}${plugin.name}`,
    })),
  });
  fs.mkdirSync(path.resolve(dir, "plugins"), { recursive: true });
  for (const plugin of listOfPlugins) {
    if (!selectedPlugins.includes(plugin.name)) continue;
    await downloadFile(
      plugin.value,
      path.resolve(dir, "plugins", plugin.name + ".jar"),
      plugin.name
    );
  }
}

export async function installForge(dir: string, javaPath: string) {
  return new Promise<void>((resolve, reject) => {
    const debugForge = Debug("ezserver:forge");
    let spinner: Ora | null = ora("Installing Forge...");
    if (debugForge.enabled) spinner = null;
    const child = cp.spawn(
      path.join(javaPath, "bin", "java"),
      ["-jar", "installer.jar", "--installServer"],
      { cwd: dir, shell: true }
    );
    debugForge(child.spawnargs);
    child.on("spawn", () => {
      debugForge("Forge installer started.");
      if (spinner) spinner.start();
    });
    child.stdout.on("data", (data) => {
      debugForge(data.toString().trim());
      if (spinner) spinner.text = data.toString().trim();
    });
    child.stderr.on("data", (data) => {
      debugForge(data.toString().trim());
      if (spinner) spinner.text = data.toString().trim();
    });
    child.on("exit", () => {
      debugForge("Forge installer exited.");
    });
    child.on("close", (code) => {
      debugForge("Forge installer exited with code %d", code);
      if (spinner) spinner.succeed("Forge installed.");
      resolve();
    });
    child.on("error", () => {
      if (spinner) spinner.fail("Forge failed to install.");
      reject();
    });
  });
}

function checkConfig(): {
  servers: ConfigServer[];
} {
  const configPath = path.resolve(os.homedir(), "ezserver.json");
  if (!fs.existsSync(configPath)) {
    logger.warn("Config file not found. Creating one...");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          servers: [],
        },
        null,
        2
      )
    );
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  if (!config.servers) {
    logger.warn("Servers key not found in config. Creating one...");
    config.servers = [];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  for (const server of config.servers) {
    server.type =
      ServerType[server.type.toUpperCase() as keyof typeof ServerType];
  }
  return config;
}

export async function manageServers(name: string) {
  const config = checkConfig();

  if (!name) {
    const { selectedServer } = await Enquirer.prompt<{
      selectedServer: string;
    }>({
      type: "select",
      name: "selectedServer",
      message: "Select a server to manage",
      choices: [
        ...config.servers.map((server: ConfigServer) => ({
          name: server.name,
          message: `${server.name} - ${server.type} (${server.path})`,
        })),
        "Add or remove a server",
      ],
    });
    if (selectedServer === "Add or remove a server") {
    } else name = selectedServer;
  }
  const server = config.servers.find(
    (server: ConfigServer) => server.name === name
  );
  debug("Using server %O", server);
  if (!server) {
    logger.error("Server not found.");
    return;
  }
}

export type ConfigServer = {
  name: string;
  path: string;
  java: string;
  type: ServerType;
};

export type CreateOptions = {
  yes?: boolean;
  overwrite?: boolean;
  dir: string;
  includePlugins?: boolean;
  useBuild?: boolean;
  port: string;
  javapath: string;
};

export type PluginsObject = {
  name: string;
  type: "direct" | "id" | "github";
  value: string;
};

export type PluginsArray = PluginsObject[];

export default {
  create,
  runServerFirst,
  hasPluginSupport,
  downloadPlugins,
  installForge,
};
