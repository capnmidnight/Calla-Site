import { versionString } from "../lib/Calla/src/version";
const c = document.querySelector("#version");
if (c) {
    c.innerHTML = versionString;
}