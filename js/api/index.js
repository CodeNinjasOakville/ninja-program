// Registers every route and exposes the one function the frontend uses.
import "./settings.js";
import "./leads.js";
import "./belts.js";
import "./active.js";
import "./rewards.js";

export { handleRequest, onDataChanged } from "./router.js";
