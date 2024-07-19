import Debug from "debug";
import cp from "child_process";
import fs from "fs";
import {
  downloadFile,
  getDownloadURL,
  getLatestVersion,
} from "./downloadUtils.js";
import { ManageAction, ServerType } from "./types.js";
import path from "path";
import ora, { Ora } from "ora";
import MimeLogger from "mime-logger";
import axios from "axios";
import semver from "semver";
import Enquirer from "enquirer";
import Config, { ConfigServer } from "./config.js";
import { askJavaPath } from "./cli.js";
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
let configInstance: Config | null = null;

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

export function getConfig() {
  if (configInstance) return configInstance;
  else return (configInstance = new Config());
}

export async function manageServers(name: string, manageAction?: ManageAction) {
  const config = getConfig().get();

  if (!name && manageAction) {
    logger.error("Server name not provided.");
    return;
  }

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
        { name: "addremove", message: "Add or remove a server" },
      ],
    });
    if (selectedServer === "addremove") {
      const { action } = await Enquirer.prompt<{ action: string }>({
        type: "select",
        name: "action",
        message: "Select an action",
        choices: ["Add server", "Remove server"],
      });
      if (action === "Add server") {
        const { info, type } = await Enquirer.prompt<{
          info: { name: string; path: string };
          type: ServerType;
        }>([
          {
            type: "form",
            name: "info",
            message: "Enter server information",
            choices: [
              {
                name: "name",
                message: "Server name",
              },
              {
                name: "path",
                message: "Server path",
              },
            ],
          },
          {
            type: "select",
            name: "type",
            message: "Server type",
            choices: Object.values(ServerType),
            result: (value) =>
              ServerType[value.toUpperCase() as keyof typeof ServerType],
          },
        ]);
        const server: ConfigServer = {
          name: info.name,
          path: info.path,
          java: await askJavaPath(),
          type,
        };
        const check = getConfig().checkServer(server);
        if (check === 1) {
          logger.error("Server with the same name already exists.");
          return;
        } else if (check === 2) {
          logger.error("Server with the same path already exists.");
          return;
        }
        getConfig().addServer(server);
        logger.info("Server added.");
        return;
      } else if (action == "Remove server") {
        // * This will not delete the folder, only remove it from the config
        const { name } = await Enquirer.prompt<{ name: string }>({
          type: "select",
          name: "name",
          message:
            "Select a server to remove. This only removes it from the config.",
          choices: config.servers.map((server: ConfigServer) => server.name),
        });
        getConfig().removeServer(name);
        logger.info("Server removed.");
        return;
      }
    } else name = selectedServer;
  }
  const server = getConfig().getServer({ name });
  debug("Using server %O", server);
  if (!server) {
    logger.error("Server not found.");
    return;
  }
  let action: ManageAction;
  if (!manageAction) {
    const { action: actionSelected } = await Enquirer.prompt<{
      action: string;
    }>({
      type: "select",
      name: "action",
      message: "Select an action",
      choices: [
        { name: "start", message: "Start server" },
        { name: "edit", message: "Edit server" },
        { name: "plugins", message: "Manage plugins" },
        { name: "properties", message: "Manage properties" },
        { name: "delete", message: "Delete server" },
      ],
    });
    const actionEnum =
      ManageAction[actionSelected.toUpperCase() as keyof typeof ManageAction];
    if (!actionEnum) {
      logger.error("Invalid action.");
      return;
    }
    action = actionEnum;
  } else {
    action = manageAction;
  }

  debug("Selected action %s", action);
  if (action === ManageAction.START) {
    await runServer(server);
  } else if (action == ManageAction.EDIT) {
    const { edit } = await Enquirer.prompt<{
      edit: string;
    }>([
      {
        type: "select",
        name: "edit",
        message: "Select a property to edit, that will edit only the config",
        choices: [
          { name: "name", message: "Name" },
          { name: "java", message: "Java" },
          { name: "path", message: "Path" },
          { name: "type", message: "Type" },
        ],
      },
    ]);
    let value;
    if (!(edit in server)) return;
    if (edit == "java") {
      value = await askJavaPath();
      if (!value) {
        logger.error("Not specified");
        return;
      }
    } else if (edit == "type") {
      const { value: value2 } = await Enquirer.prompt<{
        value: string;
      }>([
        {
          type: "select",
          name: "value",
          message: "Enter the type",
          choices: Object.values(ServerType),
          result: (value) =>
            ServerType[value.toUpperCase() as keyof typeof ServerType],
        },
      ]);
      value = value2;
    } else {
      const { value: value2 } = await Enquirer.prompt<{
        value: string;
      }>([
        {
          type: "input",
          name: "value",
          message: "Enter the value",
        },
      ]);
      value = value2;
    }
    const newServer = Object.assign({}, server);
    newServer[edit as keyof ConfigServer] = value as any;
    try {
      getConfig().editServer(server, newServer);
      logger.info("Successfully edited server");
    } catch (e: any) {
      logger.error("An error occured: " + e.message);
    }
  } else if (action === ManageAction.PLUGINS) {
    logger.info("Currently in development.");
  } else if (action === ManageAction.PROPERTIES) {
    if (!fs.existsSync(path.join(server.path, "server.properties"))) {
      logger.error(
        "server.properties not found. Please start the server first."
      );
      return;
    }
    const properties = await parseProperties(
      path.join(server.path, "server.properties")
    );
    debug("Found %s properties.", Object.keys(properties).length);
    const { property } = await Enquirer.prompt<{ property: string }>({
      type: "autocomplete",
      name: "property",
      message: "Select a property to edit",
      choices: Object.keys(properties),
    });
    debug("Selected property %s", property);
    let value = properties[property];
    // check if the property is a boolean
    debug("Value: %s", value);
    if (value == "true" || value == "false") {
      const { newValue } = await Enquirer.prompt<{ newValue: boolean }>({
        type: "confirm",
        name: "newValue",
        message: "Set the new value",
        initial: value == "true",
      });
      value = newValue.toString();
    } else if (property == "gamemode" || property == "force-gamemode") {
      const { gamemode } = await Enquirer.prompt<{ gamemode: string }>({
        type: "select",
        name: "gamemode",
        message: "Select a gamemode",
        choices: ["survival", "creative", "adventure", "spectator"],
      });
      value = gamemode;
    } else if (property == "difficulty") {
      const { difficulty } = await Enquirer.prompt<{ difficulty: string }>({
        type: "select",
        name: "difficulty",
        message: "Select a difficulty",
        choices: ["peaceful", "easy", "normal", "hard"],
      });
      value = difficulty;
    } else if (property == "level-type") {
      const { levelType } = await Enquirer.prompt<{ levelType: string }>({
        type: "select",
        name: "levelType",
        message: "Select a level type",
        choices: [
          "minecraft:normal",
          "minecraft:flat",
          "minecraft:large_biomes",
          "minecraft:amplified",
          "minecraft:buffet",
        ],
      });
      value = levelType;
    } else {
      const { value: newValue } = await Enquirer.prompt<{ value: string }>({
        type: "input",
        name: "value",
        message: "Enter the new value",
        initial: properties[property],
      });
      value = newValue;
    }
    properties[property] = value;
    const newProperties = Object.entries(properties)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    fs.writeFileSync(
      path.join(server.path, "server.properties"),
      newProperties
    );
    debug("%s: %s", property, value);
    logger.info("Property updated.");
  } else if (action === ManageAction.DELETE) {
    const { confirm } = await Enquirer.prompt<{ confirm: boolean }>({
      type: "confirm",
      name: "confirm",
      message:
        "Are you sure you want to delete the server? This action is irreversible.",
    });
    if (confirm) {
      const { confirmPath } = await Enquirer.prompt<{ confirmPath: boolean }>({
        type: "confirm",
        name: "confirmPath",
        message: `The server location is ${server.path}. Are you sure you want to delete it? This action is irreversible.`,
      });
      if (!confirmPath) return logger.info("Aborting.");
      try {
        if (!fs.existsSync(server.path)) throw new Error("Server not found.");
        if (server.path.includes("..")) throw new Error("Invalid path.");
        fs.rmSync(server.path, { recursive: true });
        getConfig().removeServer(name);
        logger.info("Server deleted.");
      } catch (e: any) {
        logger.error("Failed to delete server. " + e.message);
      }
    } else {
      logger.info("Aborting.");
    }
  } else {
    logger.error("Invalid action.");
  }
}

async function parseProperties(filePath: string): Promise<ServerProperties> {
  debug("Parsing properties file %s", filePath);
  const properties = fs.readFileSync(filePath).toString();
  const lines = properties.split("\n");
  debug("%s lines found.", lines.length);
  const parsed: ServerProperties = {} as ServerProperties;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#")) continue;
    let [key, value] = line.split("=");
    value = value.trim();
    key = key.trim();
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

export async function runServer({
  java: javaPath,
  type,
  path: dir,
}: ConfigServer) {
  if (!javaPath) {
    throw new Error("You need Java to run the server.");
  }
  return new Promise<void>((resolve) => {
    const debugServer = Debug("ezserver:run");
    const logger2 = new MimeLogger("Server");
    let cmd: string;
    let args: string[] = [];
    if (type === ServerType.FORGE) {
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
    process.stdin.pipe(child.stdin);
    debug(child.spawnargs);
    child.on("spawn", () => {
      debugServer("Server starting.");
    });
    child.stdout.on("data", (data) => {
      logger2.info(data.toString().trim());
    });
    child.stderr.on("data", (data) => {
      logger2.warn(data.toString().trim());
    });
    child.on("exit", () => {
      debugServer("Server exited.");
    });
    child.on("close", (code) => {
      debugServer("Server exited with code %d", code);
      resolve();
    });
    child.on("error", () => {
      resolve();
    });
  });
}

export type CreateOptions = {
  yes?: boolean;
  overwrite?: boolean;
  dir: string;
  includePlugins?: boolean;
  useBuild?: boolean;
  port: string;
  add: boolean;
  javapath: string;
  skipFirst?: boolean;
};

export type ServerProperties = {
  "accepts-transfers": boolean;
  "allow-flight": boolean;
  "allow-nether": boolean;
  "broadcast-console-to-ops": boolean;
  "broadcast-rcon-to-ops": boolean;
  "bug-report-link": string;
  debug: boolean;
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  "enable-command-block": boolean;
  "enable-jmx-monitoring": boolean;
  "enable-query": boolean;
  "enable-rcon": boolean;
  "enable-status": boolean;
  "enforce-secure-profile": boolean;
  "enforce-whitelist": boolean;
  "entity-broadcast-range-percentage": number;
  "force-gamemode": boolean;
  "function-permission-level": number;
  gamemode: "survival" | "creative" | "adventure" | "spectator";
  "generate-structures": boolean;
  "generator-settings": string;
  hardcore: boolean;
  "hide-online-players": boolean;
  "initial-disabled-packs": string;
  "initial-enabled-packs": string;
  "level-name": string;
  "level-seed": string;
  "level-type":
    | "minecraft:normal"
    | "minecraft:flat"
    | "minecraft:large_biomes"
    | "minecraft:amplified"
    | "minecraft:buffet";
  "log-ips": boolean;
  "max-chained-neighbor-updates": number;
  "max-players": number;
  "max-tick-time": number;
  "max-world-size": number;
  motd: string;
  "network-compression-threshold": number;
  "online-mode": boolean;
  "op-permission-level": number;
  "player-idle-timeout": number;
  "prevent-proxy-connections": boolean;
  pvp: boolean;
  "query.port": number;
  "rate-limit": number;
  "rcon.password": string;
  "rcon.port": number;
  "region-file-compression": string;
  "require-resource-pack": boolean;
  "resource-pack": string;
  "resource-pack-id": string;
  "resource-pack-prompt": string;
  "resource-pack-sha1": string;
  "server-ip": string;
  "server-port": number;
  "simulation-distance": number;
  "spawn-animals": boolean;
  "spawn-monsters": boolean;
  "spawn-npcs": boolean;
  "spawn-protection": number;
  "sync-chunk-writes": boolean;
  "text-filtering-config": string;
  "use-native-transport": boolean;
  "view-distance": number;
  "white-list": boolean;
  [key: string]: any;
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
