#!/usr/bin/env node

import getJavaPaths from "./JavaUtils.js";
import fs from "fs";
import path from "path";
import Logger from "mime-logger";
import Debug from "debug";
import { Command } from "commander";
import { create, CreateOptions, runServer } from "./core.js";
import enquirer from "enquirer";
import { getJavaForMCVersion } from "./JavaUtils.js";
import { ServerType } from "./types.js";
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
  .action(
    async (
      name: string,
      type: string,
      version: string,
      options: CreateOptions
    ) => {
      try {
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
        }
        await create(
          name,
          typeEnum,
          version,
          Object.assign(options, { javapath: await askJavaPath(version) })
        );
        if (options.javapath) {
          logger.info("Running server jar for first start...");
          await runServer(options.dir, options.javapath);
        } else {
          logger.warn(
            "You need Java to run the server. Install it and run the server jar."
          );
        }
        debug("Server created successfully.");
        logger.info("Server created successfully.");
        logger.info(
          "Run it with EZServer or by running the server jar. (java -jar server.jar)"
        );
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
  .argument("<name>", "Name of the server.")
  .action((name) => {
    try {
      debug("Managing server %s...", name);
      throw new Error("Not implemented.");
    } catch (e: any) {
      logger.error("An error occurred: %s", e.message);
    }
  });

debug("Finished loading EZServer.");
program.parse();
async function askJavaPath(version: string): Promise<string> {
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
      return detectedJava;
    } catch (e: any) {
      logger.error("An error occurred while detecting java: %s", e.message);
      process.exit(1);
    }
  }
  debug("Using Java %s", javaPath);
  return javaPath;
}
