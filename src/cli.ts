#!/usr/bin/env node

import getJavaPaths from "./JavaUtils.js";
import fs from "fs";
import path from "path";
import Logger from "mime-logger";
import Debug from "debug";
import { Command } from "commander";
import {
  create,
  CreateOptions,
  hasPluginSupport,
  runServerFirst,
  downloadPlugins,
  manageServers,
} from "./core.js";
import enquirer from "enquirer";
import { getJavaForMCVersion } from "./JavaUtils.js";
import { ServerType } from "./types.js";
import { DownloadError, DownloadErrorCodes } from "./downloadUtils.js";
const program = new Command();
const debug = Debug("ezserver:cli");
const javaVersions: {
  version: string;
  path: string;
  detectedVersion: number | string;
}[] = [];
const logger = new Logger();

async function populateJavaVersions() {
  debug("Populating Java versions...");
  const isJava = await getJavaPaths()
    .then((res) => {
      for (const javaPath of res) {
        if (!fs.existsSync(path.join(javaPath, "release"))) {
          logger.warn("No release file found in Java path: %s", javaPath);
          continue;
        }
        const version =
          fs.readFileSync(path.join(javaPath, "release"), "utf8") || "";
        if (!version) {
          logger.warn("No release file found in Java path: %s", javaPath);
          continue;
        }
        if (!version.includes("JAVA_VERSION=")) {
          logger.warn("No release file found in Java path: %s", javaPath);
          continue;
        }
        const versionNumber = /JAVA_VERSION="(.*)"/.exec(version)?.[1];
        if (!versionNumber) {
          logger.warn("No release file found in Java path: %s", javaPath);
          continue;
        }
        let detectedVersion: string | number = versionNumber;
        if (versionNumber.includes("1.")) {
          detectedVersion = versionNumber.split(".")[1];
        }
        const regex = /(\d{2})\./;
        const match = regex.exec(versionNumber);
        if (match) {
          detectedVersion = match[1];
        }
        detectedVersion = parseInt(detectedVersion);
        if (isNaN(detectedVersion)) {
          detectedVersion = versionNumber;
        }
        javaVersions.push({
          version: versionNumber,
          path: javaPath,
          detectedVersion,
        });
      }
      return !!javaVersions.length;
    })
    .catch((err) => {
      console.error(err);
    });
  if (!isJava) {
    logger.warn("No Java has been detected. Some features may not work.");
  } else {
    debug("Java versions detected: %O", javaVersions);
    logger.info(`Detected ${javaVersions.length} Java.`);
  }
}

logger.info("Loading EZServer...");
await populateJavaVersions();

program
  .name("ezserver")
  .description("A simple Minecraft server manager.")
  .version(process.env.npm_package_version || "0.0.0");

program
  .command("create")
  .description("Create a new server.")
  .argument("<name>", "Name of the server.")
  .argument("<type>", "Type of the server.")
  .argument("<version>", "Version of the server.")
  .option("-d, --dir <dir>", "Directory to create the server in.")
  .option(
    "-i, --include-plugins",
    "Include plugins in the server. Only works with Spigot/Paper."
  )
  .option("-p, --port <port>", "Port to run the server on.")
  .option(
    "-b, --use-build",
    "Use BuildTools to build the server. (ONLY SPIGOT)"
  )
  .option("-y, --yes", "Skip all prompts.")
  .option("-o, --overwrite", "Overwrite the directory if it exists.")
  .action(
    async (
      name: string,
      type: string,
      version: string,
      options: CreateOptions
    ) => {
      try {
        debug("Preparing to create server...");
        const typeEnum =
          ServerType[type.toUpperCase() as keyof typeof ServerType];
        if (!typeEnum) {
          logger.error("Invalid server type: %s", type);
          return;
        }
        if (!options.dir) options.dir = path.join(process.cwd(), name);
        if (!options.port) options.port = "25565";
        logger.info("Creating server %s...", name);
        if (fs.existsSync(options.dir)) {
          logger.error("Directory already exists: %s", options.dir);
          if (!options.overwrite) {
            const { confirm } = (await enquirer.prompt({
              type: "confirm",
              name: "confirm",
              message: "Do you want to overwrite it?",
            })) as { confirm: boolean };
            if (!confirm) {
              logger.warn("Server creation cancelled.");
              return;
            } else {
              logger.warn("Overwriting directory %s...", options.dir);
              fs.rmSync(options.dir, { recursive: true });
            }
          } else {
            logger.warn("Overwriting directory %s...", options.dir);
            fs.rmSync(options.dir, { recursive: true });
          }
        }
        if (options.yes && !options.useBuild) {
          options.useBuild = false;
        }
        if (typeEnum === ServerType.SPIGOT && options.useBuild == undefined) {
          const { useBuild } = (await enquirer.prompt({
            type: "confirm",
            name: "useBuild",
            message: "Do you want to use BuildTools (if no, using GetBukkit) ?",
          })) as { useBuild: boolean };
          options.useBuild = useBuild;
        }
        try {
          await create(
            name,
            typeEnum,
            version,
            Object.assign(options, {
              javapath: await askJavaPath(version, options.yes),
            })
          );
        } catch (e: any) {
          if (e instanceof DownloadError) {
            switch (e.code) {
              case DownloadErrorCodes.VERSION_NOT_FOUND:
                logger.error("Provied version cannot be found.");
                break;
              case DownloadErrorCodes.DESTINATION_NOT_FOUND:
                logger.error("Destination directory not found.");
                break;
              case DownloadErrorCodes.NO_BUILDS:
                logger.error("No builds found for the version.");
                break;
              case DownloadErrorCodes.UNSUPPORTED_TYPE:
                logger.error("Unsupported server type.");
                break;
              default:
                logger.error("An error occured while creating the server.");
                logger.error(e.message);
                break;
            }
            return;
          } else {
            logger.error("An error occured while creating the server.");
            logger.error(e.message);
            return;
          }
        }
        if (options.includePlugins) {
          if (!hasPluginSupport(typeEnum)) {
            logger.warn("Plugins are not supported for a %s server.", typeEnum);
          } else {
            logger.info("Downloading plugins...");
            await downloadPlugins(options.dir, version, typeEnum);
          }
        }
        const files = [options.dir + "/run.bat", options.dir + "/run.sh"];
        for (const file of files) {
          if (fs.existsSync(file)) {
            const data = fs.readFileSync(file, "utf8");
            fs.writeFileSync(
              file,
              data.replace(/java/g, path.join(options.javapath, "bin", "java"))
            );
          }
        }
        if (options.javapath) {
          logger.info("Running server jar for first start...");
          await runServerFirst(options.dir, options.javapath, typeEnum);
        } else {
          logger.warn(
            "You need Java to run the server. Install it and run the server jar."
          );
        }
        debug("Server created successfully.");
        logger.info("Server created successfully.");
        const isWindows: boolean = process.platform.indexOf("win") === 0;
        if (typeEnum === ServerType.FORGE) {
          logger.info(
            `Run it with EZServer or by running the script. (${
              isWindows ? "run.bat" : "run.sh"
            })`
          );
        } else {
          logger.info(
            "Run it with EZServer or by running the server jar. (java -jar server.jar)"
          );
        }
        logger.info("Server directory: %s", options.dir);
        logger.info("Connect using: localhost:%s", options.port);
      } catch (e: any) {
        logger.error("An error occurred: %s", e.message);
      }
    }
  );

program
  .command("manage")
  .description("Manage an existing server.")
  .argument("[name]", "Name of the server.")
  .action((name) => {
    try {
      debug("Managing server %s...", name);
      manageServers(name);
    } catch (e: any) {
      logger.error("An error occurred: %s", e.message);
    }
  });

debug("Finished loading EZServer.");
program.parse();
async function askJavaPath(
  version: string,
  yes: boolean = false
): Promise<string> {
  if (!javaVersions.length) {
    logger.warn("No Java has been detected. Some features may not work.");
    return "";
  }
  if (javaVersions.length === 1) {
    logger.warn(
      "Only one Java version detected. Using Java %s",
      javaVersions[0].detectedVersion
    );
    return javaVersions[0].path;
  }
  const versions = javaVersions
    .sort((a, b) => {
      if (typeof a.detectedVersion === "string") return 1;
      if (typeof b.detectedVersion === "string") return -1;
      return b.detectedVersion - a.detectedVersion;
    })
    .map((java) => ({
      name: java.path,
      message:
        "Java " + java.detectedVersion + ` (${java.version}) - ` + java.path,
    }));
  if (yes) {
    debug("Detecting Java path...");
    try {
      const detectedJava = await getJavaForMCVersion(version, javaVersions);
      if (!detectedJava) {
        logger.warn(
          "No Java version detected for Minecraft version %s",
          version
        );
        return "";
      }
      debug("Detected Java %s", detectedJava);
      logger.info("Using Java %s", detectedJava);
      return detectedJava;
    } catch (e: any) {
      logger.error("An error occurred while detecting java: %s", e.message);
      process.exit(1);
    }
  }
  const { javaPath } = (await enquirer.prompt({
    type: "select",
    name: "javaPath",
    message: "Select a Java version to use:",
    initial: versions.length,
    choices: [
      ...versions,
      {
        name: "detect",
        message: "Detect for you",
        hint: "Based on minecraft version",
      },
    ],
  })) as { javaPath: string };
  if (javaPath === "detect") {
    debug("Detecting Java path...");
    try {
      const detectedJava = await getJavaForMCVersion(version, javaVersions);
      if (!detectedJava) {
        logger.warn(
          "No Java version detected for Minecraft version %s",
          version
        );
        return "";
      }
      debug("Detected Java %s", detectedJava);
      logger.info("Using Java %s", detectedJava);
      return detectedJava;
    } catch (e: any) {
      logger.error("An error occurred while detecting java: %s", e.message);
      process.exit(1);
    }
  }
  logger.info("Using Java %s", javaPath);
  return javaPath;
}
