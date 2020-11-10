import fs from "fs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import callaRollupConfig from "./scripts/lib/Calla/rollup.config";

const traceKit = fs.readFileSync("node_modules/tracekit/tracekit.js", { encoding: "utf8" });
const banner = `${traceKit}
(function(){
var keepTrying = true;
TraceKit.report.subscribe((err) => {
    if(keepTrying){
        try{
            err.userAgent = navigator.userAgent;
            const xhr = new XMLHttpRequest();
            xhr.onerror = function() { keepTrying = false; };
            xhr.open("POST", "/ErrorLog");
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(JSON.stringify(err));
        }
        catch(exp){
            keepTrying = false;
        }
    }
});
})();
try{
`;
const footer = `
} catch(exp) {
    TraceKit.report(exp);
}`;

function def(root, name, withTraceKit, minify) {
    const opts = {
        input: `${root}/${name}/index.js`,
        plugins: [
            nodeResolve()
        ],
        output: [{
            sourcemap: true,
            file: `wwwroot/scripts/${name}.js`
        }]
    };

    if (process.env.BUILD === "production" && minify) {
        opts.output.push({
            sourcemap: true,
            file: `wwwroot/scripts/${name}.min.js`,
            plugins: [terser({
                module: true
            })]
        });
    }

    if (withTraceKit) {
        for (let output of opts.output) {
            output.banner = banner;
            output.footer = footer;
        }
    }

    return opts;
}

const bundles = [];

if (process.env.BUILD === "production") {
    bundles.push(def("scripts", "version", false, true));
    for (const config of callaRollupConfig) {
        config.input = "scripts/lib/Calla/" + config.input;
    }
    bundles.push(...callaRollupConfig);
}

if (process.env.BUILD === "development") {
    bundles.push(def("scripts/lib/Calla", "tests", false, false));
}

if (process.env.BUILD === "production"
    || process.env.BUILD === "development"
    || process.env.BUILD === "basic") {
    bundles.push(def("scripts/lib/Calla/examples", "basic", false, true));
}

if (process.env.BUILD === "production"
    || process.env.BUILD === "development"
    || process.env.BUILD === "game") {
    bundles.push(def("scripts/lib/Calla/examples", "game", true, true));
}

export default bundles;