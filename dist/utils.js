import Logger from "mime-logger";
const logger = new Logger();
export async function printServerInfo(server) {
    logger.info("Server type: %s", server.type);
    logger.info("Server version: %s", server.version);
    logger.info("Server name: %s", server.name);
    logger.info("Server port: %s", server.port);
    logger.info("Server folder: ./%s", server.name);
    logger.info("Full string: %s %s on ./%s listening 127.0.0.1:%s", server.type, server.version, server.name, server.port);
}
