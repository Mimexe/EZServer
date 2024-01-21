#!/usr/bin/env node
console.log("Loading...");
import Logger from "mime-logger";
import inquirer from "inquirer";
import fs from "fs";
import { printServerInfo } from "./utils.js";
import cp from "child_process";
import DownloadUtils from "./downloadUtils.js";
const logger = new Logger();
console.clear();
logger.info("Welcome to EZServer!");
async function mainMenu() {
  const { action } = await inquirer.prompt<{ action: MainMenuActions }>([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Create a server", value: "create" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);
  await executeAction(action);
}

async function executeAction(action: MainMenuActions) {
  switch (action) {
    case "create":
      await createServerMenu();
      break;
    case "exit":
      logger.info("Exiting...");
      process.exit(0);
    default:
      logger.error("Invalid action: " + action);
      main();
      break;
  }
}

async function createServerMenu() {
  const answers = await inquirer.prompt<Server>([
    {
      type: "list",
      name: "type",
      message: "What type of server would you like to create?",
      choices: [
        { name: "Vanilla", value: "vanilla" },
        { name: "Bukkit", value: "bukkit" },
        { name: "Spigot", value: "spigot" },
        { name: "Paper", value: "paper" },
        { name: "Purpur", value: "purpur" },
        { name: "Forge", value: "forge" },
      ],
    },
    {
      type: "input",
      name: "version",
      message: "What version of the server would you like to create?",
      default: "1.20.1",
      validate: (input: string) => {
        //   regex example: 1.16.5 YES 1.16 YES 1..5 NO 1.5.5.5 NO 0.0.0 NO 1.16.5-pre1 NO
        if (input.match(/^\d+\.\d+(\.\d+)?$/)) {
          return true;
        }
        return "Invalid version number";
      },
    },
    {
      type: "input",
      name: "name",
      message: "What would you like to name your server?",
      validate: (input: string) => {
        if (input.length > 255) {
          return "Server name too long";
        }
        if (input.length < 1) {
          return "Server name too short";
        }
        if (input.match(/\.+$/)) {
          return "Server name cannot end with a period";
        }
        if (input.match(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i)) {
          return "Server name cannot be a reserved name";
        }
        if (fs.existsSync(input)) {
          return "Server name already exists";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "port",
      message: "What port would you like to run your server on?",
      default: 25565,
      validate: (input: number) => {
        if (
          !isNaN(input) &&
          input >= 0 &&
          input <= 65535 &&
          Number.isInteger(input)
        ) {
          return true;
        }
        return "Invalid port number";
      },
    },
  ]);
  await printServerInfo(answers);
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: "Is this correct?",
      default: true,
    },
  ]);
  if (!confirm) {
    logger.info("Aborting...");
    main();
    return;
  }
  await createServer(answers.type, answers.version, answers.name, answers.port);
}

async function confirm(message: string = "Are you sure?"): Promise<boolean> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message,
      default: true,
    },
  ]);
  return confirm;
}

function getCommand(type: ServerType) {
  switch (type) {
    case "vanilla":
    case "bukkit":
    case "spigot":
    case "paper":
      return "java -Xmx1024M -Xms1024M -jar server.jar nogui";
    case "purpur":
      return "java -Xmx1024M -Xms1024M --add-modules=jdk.incubator.vector -jar server.jar nogui";
    default:
      return "java -Xmx1024M -Xms1024M -jar server.jar nogui";
  }
}

async function createServer(
  type: ServerType,
  version: string,
  name: string,
  port: number
) {
  logger.info(
    "Creating %s %s server on folder %s on 127.0.0.1:%s",
    type,
    version,
    name,
    port
  );
  const downloadUtils = new DownloadUtils();
  const server = {
    type,
    version,
    name,
    port,
  };
  await downloadUtils.downloadServer(server);
  if (!(await confirm("Do you accept the EULA ?"))) {
    logger.warn("Accepting the eula is required to run the server");
  } else {
    fs.writeFileSync(`./${server.name}/eula.txt`, "eula=true\n");
  }
  fs.writeFileSync(
    `./${server.name}/start.bat`,
    `${getCommand(server.type)}\npause`
  );
  fs.writeFileSync(
    `./${server.name}/server.properties`,
    `server-port=${port}\n`
  );
  if (
    (server.type === "spigot" ||
      server.type === "paper" ||
      server.type === "purpur") &&
    (await confirm("Do you want to install recommended plugins ?"))
  ) {
    await downloadUtils.downloadPlugins(server);
  }
  if (await confirm("Start server now ?")) {
    await new Promise<void>((resolve) => {
      const child = cp.spawn(getCommand(server.type), {
        shell: true,
        cwd: `./${server.name}`,
      });
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.stdout?.on("data", (data) => {
        if (
          data.toString().trim().includes("Done (") &&
          data.toString().trim().includes('s)! For help, type "help"')
        ) {
          logger.info("Server started!");
          logger.info("Stopping server in 5 seconds...");
          setTimeout(() => {
            child.stdin?.write("stop\n");
          }, 5000);
        }
      }) || console.log("no stdout :(");
      child.on("close", (code) => {
        logger.info("Server exited with code %s", code);
        resolve();
      });
    });
  }
  logger.info("Server ready!");
  logger.info(
    "Start 'start.bat' or '" + getCommand(server.type) + "' to start the server"
  );
  process.exit(0);
}

async function main() {
  try {
    if (process.platform !== "win32") {
      logger.error("Windows is the only supported platform at the moment");
      (await confirm("Do you want to continue anyway ? (not recommended)"))
        ? console.log("Continuing...")
        : process.exit(1);
    }
    console.clear();
    await mainMenu();
    logger.info("Thanks for using EZServer!");
  } catch (error: any) {
    logger.error(
      "Fatal error while running program:\n" + error.stack ||
        error.message ||
        error
    );
    process.exit(1);
  }
}

main();
