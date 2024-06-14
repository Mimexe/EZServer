import Debug from "debug";
import fs from "fs";
import { downloadFile, getVersionForType as getDownloadURL, } from "./DownloadUtils.js";
import { ServerType } from "../index.js";
const debug = Debug("ezserver:main");
export async function create(name, type, version, options) {
    let hasJava = false;
    debug("Creating server %s of type %s with version %s and options %O", name, type, version, options);
    if (!options.dir)
        throw new Error("Directory not provided.");
    if (!options.port)
        throw new Error("Port not provided.");
    if (!options.javapath || !fs.existsSync(options.javapath)) {
        debug("Java path not provided or innexistent.");
    }
    else {
        hasJava = true;
    }
    if (options.includePlugins &&
        type !== ServerType.SPIGOT &&
        type !== ServerType.PAPER) {
        throw new Error("Plugins can only be included with Spigot/Paper servers.");
    }
    debug("Creating server...");
    debug("Checking for server type %s...", type);
    switch (type) {
        case ServerType.VANILLA:
            debug("Creating Vanilla server...");
            fs.mkdirSync(options.dir, { recursive: true });
            await downloadFile(await getDownloadURL(version, type), options.dir + "/version_manifest.json");
            break;
        case ServerType.SPIGOT:
            debug("Creating Spigot server...");
            // await createSpigotServer();
            break;
        case ServerType.PAPER:
            debug("Creating Paper server...");
            // await createPaperServer();
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
export default {
    create,
};
