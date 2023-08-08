#!/usr/bin/env -S deno run -A
// version: v0.2.0

import {
  Fragment,
  h,
  toString as renderToString,
} from "https://deno.land/x/jsx_to_string@v0.3.0/mod.ts";

import { ensureFileSync } from "https://deno.land/std@0.196.0/fs/ensure_file.ts";
import { walkSync } from "https://deno.land/std@0.196.0/fs/walk.ts";
import { extname } from "https://deno.land/std@0.196.0/path/mod.ts";
import { basename } from "https://deno.land/std@0.196.0/path/mod.ts";
import { existsSync } from "https://deno.land/std@0.196.0/fs/mod.ts";
import { parse as parseArgs } from "https://deno.land/std@0.196.0/flags/mod.ts";

const defaultPort = 3000;
const scriptOutputDelimiter = "~~~~~~~[response]~~~~~~\n`";
const watchFsPath = "$__WATCHFS__";
let pageAutoReload = true;

export { h, Fragment };

export async function $(page: JSX.Element | Promise<JSX.Element>) {
  page = await Promise.resolve(page);
  const output = renderToString(page);
  console.log(output);
}

// deno-lint-ignore no-namespace
export namespace $ {
  export const createElement = h;
  export const createFragment = Fragment;

  export interface ScriptRequest {
    method: string;
    url: string;
    body: string;
    data: Record<string, string>;
  }

  export interface ScriptResponse {
    status?: number;
    statusText?: string;
    headers: Record<string, string>;
  }

  export const request: ScriptRequest = {
    method: "",
    url: "",
    body: "",
    data: {},
  };

  export const response: ScriptResponse = {
    headers: {},
  };
}

const srcDir = "src";
const buildDir = "build";

let fsWatcher: ReturnType<typeof common.createFileWatcher> | null = null;

const common = {
  tryCatch<T>(fn: () => T): [T, null] | [null, Error] {
    try {
      return [fn(), null];
    } catch (e) {
      if (e instanceof Error) return [null, e];
      return [null, new Error(e + "")];
    }
  },
  isFileNewer(newer: string, older: string) {
    const [newStat, err1] = common.tryCatch(() => Deno.statSync(newer));
    const [olderStat, err2] = common.tryCatch(() => Deno.statSync(older));

    if (err2 !== null || err1 !== null) return true;

    return (newStat.mtime ?? 1) > (olderStat.mtime ?? 1);
  },
  copyIfNewer(src: string, dest: string) {
    ensureFileSync(dest);
    if (common.isFileNewer(src, dest)) {
      console.log("copy", dest);
      Deno.copyFileSync(src, dest);
    } else {
      console.log("skip", dest);
    }
  },
  getSrcPath(buildFile: string) {
    const fields = buildFile.split("/");
    fields[fields.length - 1] = fields[fields.length - 1].replace(
      /\.html/,
      ".tsx"
    );
    return srcDir + "/" + fields.slice(1).join("/");
  },
  getDestPath(srcFile: string) {
    const fields = srcFile.split("/");
    fields[fields.length - 1] = fields[fields.length - 1].replace(
      /\.tsx/,
      ".html"
    );
    return buildDir + "/" + fields.slice(1).join("/");
  },

  async loadRequestData() {
    try {
      const contents = await common.Uint8ArrayStreamToString(
        Deno.stdin.readable
      );
      const req = JSON.parse(contents) as $.ScriptRequest;
      if (req) {
        $.request.method = req.method;
        $.request.url = req.url;
        $.request.data = req.data;
        $.request.body = req.body;
      }
    } catch (_) {
      /* ignore */
    }
  },

  async Uint8ArrayStreamToString(
    stream: ReadableStream<Uint8Array>
  ): Promise<string> {
    const result: string[] = [];
    for await (const chunk of stream
      .pipeThrough(new TextDecoderStream())
      .values()) {
      result.push(chunk);
    }
    return result.join("");
  },

  getRequestData(req: Request) {
    const result: Record<string, string> = {};
    for (const [k, v] of new URL(req.url).searchParams) {
      result[k] = v;
    }
    //TODO: get req.formData
    return result;
  },

  getStaticPath(href: string, includeHash = false) {
    if (href.endsWith("/")) {
      href += "index.tsx";
    }

    const extIndex = href.indexOf(".tsx");
    const hashIndex = href.indexOf("#");
    const pathname = href.slice(0, extIndex);
    const queryString = href
      .slice(extIndex + 4, hashIndex < 0 ? undefined : hashIndex)
      .trim();

    const suffix = includeHash && hashIndex >= 0 ? href.slice(hashIndex) : "";

    if (queryString.length === 0) {
      return pathname + ".html" + suffix;
    }
    const searchParams = new URLSearchParams(queryString);

    const entries: [string, string][] = [];
    for (const [k, v] of searchParams.entries()) {
      entries.push([k, v]);
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    return (
      pathname +
      "[" +
      entries.map(([k, v]) => `${k}=${v}`).join(",") +
      "].html" +
      suffix
    );
  },

  getAndReplaceLocalLinks(
    html: string,
    domParser: { parseFromString: any }
  ): [string[], string] {
    const dom = domParser.parseFromString(html, "text/html");
    const result: string[] = [];
    for (const child of dom.querySelectorAll("a")) {
      const a = child as { href: string; attributes: Record<string, string> };
      if (!a.href.match(/^https?:\/\//) && !a.attributes["data-no-render"]) {
        result.push(a.href);
        a.href = common.getStaticPath(a.href, true);
      }
    }
    return [result, dom.toString()];
  },

  stripQueryParam(pathname: string) {
    const i = pathname.lastIndexOf("?");
    return i < 0 ? pathname : pathname.slice(0, i);
  },

  createFileWatcher() {
    let idCounter = 0;
    type Listener = (paths: string[]) => void;
    const listeners = new Map<number, Listener>();
    let running = true;

    (async () => {
      console.log("starting file watcher");
      for await (const e of Deno.watchFs(srcDir, { recursive: true })) {
        if (e.kind === "create" || e.kind === "modify") {
          for (const [_, fn] of listeners.entries()) {
            fn(e.paths);
          }
        }
        if (!running) break;
      }
    })();

    return {
      stop() {
        running = false;
        for (const [id] of listeners.entries()) listeners.delete(id);
      },
      listen(fn: Listener) {
        const id = ++idCounter;
        listeners.set(id, fn);
        return id;
      },
      unlisten(id: number) {
        listeners.delete(id);
      },
    };
  },

  createFsEventResponse() {
    let timer: number | undefined = undefined;
    const enc = new TextEncoder();
    let fsWatchID: number | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => {
          controller.enqueue(enc.encode(`event: ping\n\n`));
        }, 5 * 1000);

        if (!fsWatcher) {
          fsWatcher = common.createFileWatcher();
        }

        fsWatchID = fsWatcher?.listen((filenames: string[]) => {
          controller.enqueue(
            enc.encode(
              "event: fsevent\n" + `data: {filename: "${filenames}"}\n\n`
            )
          );
        });
      },
      cancel() {
        if (timer !== undefined) {
          clearInterval(timer);
        }
        if (fsWatchID) {
          fsWatcher?.unlisten(fsWatchID);
        }
      },
    });

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
      },
    });
  },
};

export const runner = {
  render() {
    for (const filename of Deno.args) {
      const command = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", filename],
        stdout: "piped",
        env: { NO_COLOR: "1" },
      });

      command.spawn().stdout.pipeTo(Deno.stdout.writable);
    }
  },

  async renderToString(pageFilename: string, requestData: $.ScriptRequest) {
    // TODO: use MessagePack
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", pageFilename],
      env: { NO_COLOR: "✓", PHP_TS_RENDER: "✓" },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const { stdin, stdout, stderr } = command.spawn();

    const w = stdin.getWriter();
    await w.write(new TextEncoder().encode(JSON.stringify(requestData)));
    w.close();

    let [out, err] = await Promise.all([
      await common.Uint8ArrayStreamToString(stdout),
      await common.Uint8ArrayStreamToString(stderr),
    ]);

    let scriptResponse: $.ScriptResponse | null = null;

    const index = out.indexOf(scriptOutputDelimiter);
    if (index >= 0) {
      const jsonStr = out.slice(index + scriptOutputDelimiter.length);
      scriptResponse = JSON.parse(jsonStr);
      out = out.slice(0, index);
    }

    return { out, err, scriptResponse };
  },

  async renderToFile(
    pageFilename: string,
    destPath: string,
    requestData: $.ScriptRequest
  ) {
    const { out, err, scriptResponse } = await runner.renderToString(
      pageFilename,
      requestData
    );

    if (err.length > 0) {
      console.log("error:");
      console.log(err);
      console.log("------------------");
    }

    if (scriptResponse) {
      console.log(scriptResponse);
      console.log("------------------");
    }

    if (out.length > 0) {
      Deno.writeTextFile(destPath, out);
    } else {
      console.log("no output", destPath);
    }
  },

  cleanBuild() {
    console.log("cleaning", buildDir);
    Deno.removeSync(buildDir, { recursive: true });
  },

  async renderFetch(srcPath: string, destPath: string) {
    console.log("render", destPath);
    if (srcPath.startsWith(srcDir)) {
      srcPath = srcPath.slice(srcDir.length);
    }

    const url = `http://localhost:${defaultPort}${srcPath}`;
    const resp = await fetch(url);
    ensureFileSync(destPath);
    const f = await Deno.open(destPath, {
      create: true,
      truncate: true,
      write: true,
    });
    await resp.body?.pipeTo(f.writable);
  },

  async buildAll(noCheck = false) {
    const abortController = runner.serveDev(defaultPort, false);

    const result = {
      skipped: 0,
      rendered: 0,
      copied: 0,
    };

    const buildSet = new Set<string>();
    const files: string[] = [];
    const invalidLinks = new Set<string>();

    for (const entry of walkSync(srcDir)) {
      if (entry.isDirectory) continue;

      const destPath = common.getDestPath(entry.path);

      if (!(common.isFileNewer(entry.path, destPath) || noCheck)) {
        console.log("skip", destPath);
        continue;
      }

      if (extname(entry.path) !== ".tsx") {
        console.log("copy", destPath);
        ensureFileSync(destPath);
        console.log("copy", destPath);
        Deno.copyFileSync(entry.path, destPath);
        result["copied"]++;
      } else {
        files.push(entry.path);
      }
    }

    const { DOMParser } = await import("https://esm.sh/linkedom@0.14.22");

    const domParser = new DOMParser();

    while (files.length > 0) {
      let pathname = files.pop() ?? "";
      if (pathname.startsWith(srcDir)) {
        pathname = pathname.slice(srcDir.length);
      }
      const outputFilename = buildDir + common.getStaticPath(pathname, false);
      if (buildSet.has(outputFilename)) continue;
      buildSet.add(outputFilename);

      await runner.renderFetch(pathname, outputFilename);
      result["rendered"]++;

      const html = await Deno.readTextFile(outputFilename);
      const [links, updatedHtml] = common.getAndReplaceLocalLinks(
        html,
        domParser
      );
      Deno.writeTextFile(outputFilename, updatedHtml);
      for (let link of links) {
        if (!link.startsWith("/")) link = "/" + link;
        const filename = srcDir + common.stripQueryParam(link);
        if (!existsSync(filename)) {
          invalidLinks.add(srcDir + link);
          continue;
        }
        files.push(link);
      }
    }

    if (invalidLinks.size > 0) {
      const lines: string[] = [];
      for (const l of invalidLinks) lines.push(l);
      Deno.stderr.write(
        new TextEncoder().encode("** invalid links: " + lines.join(", ") + "\n")
      );
    }

    console.log("build status", result);
    abortController.abort();
  },

  async runScript(srcPath: string) {
    if (srcPath.startsWith(srcDir)) {
      srcPath = srcPath.slice(srcDir.length);
    }

    const url = `http://localhost:${defaultPort}${srcPath}`;
    const resp = await fetch(url);
    await resp.body?.pipeTo(Deno.stdout.writable, {
      preventAbort: true,
      preventCancel: true,
      preventClose: true,
    });
  },

  serve(port: number) {
    Deno.serve({ port, hostname: "0.0.0.0" }, async (req) => {
      try {
        let pathname = new URL(req.url).pathname;
        if (pathname === "/") {
          pathname = "/index.html";
        }

        const file = await Deno.open(buildDir + pathname, { read: true });
        return new Response(file.readable);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          return new Response("not found", { status: 404 });
        } else if (e instanceof Error) {
          return new Response(e.message, { status: 500 });
        }
        return new Response("huh:" + e, { status: 500 });
      }
    });
  },

  serveDev(port: number, logHostname = true) {
    const abort = new AbortController();
    Deno.serve(
      {
        port,
        hostname: "0.0.0.0",
        signal: abort.signal,
        onListen: () => {
          if (logHostname) {
            console.log(`listening on http://localhost:${port}`);
          }
        },
      },
      async (req) => {
        console.log(req.method, req.url);
        try {
          let pathname = new URL(req.url).pathname;
          if (pathname === "/" + watchFsPath && pageAutoReload) {
            return common.createFsEventResponse();
          }

          if (pathname === "/") {
            pathname = "/index.html";
          }

          if (!pathname.endsWith(".html") && !pathname.endsWith(".tsx")) {
            const file = await Deno.open(srcDir + pathname, { read: true });
            return new Response(file.readable);
          }

          const filename = common.getSrcPath(srcDir + pathname);

          let { out, err, scriptResponse } = await runner.renderToString(
            filename,
            {
              method: req.method,
              url: req.url,
              data: common.getRequestData(req),
              body: req.body
                ? await common.Uint8ArrayStreamToString(req.body)
                : "",
            } satisfies $.ScriptRequest
          );

          if (pageAutoReload) {
            out += `
<script>
// This is an injected page autoreload script.
// You can disable this on dev with --no-autoreload
var evtSource = new EventSource("${watchFsPath}");
evtSource.addEventListener("fsevent", function(event) {
  window.location.reload();
});
window.addEventListener("unload", function() { evtSource.close(); })
</script>`;
          }

          if (err != "") {
            out =
              `<div style='white-space: pre-wrap; font-size: 33px;background: red; color'>ruh-oh\n${err}</div>` +
              out;
          }

          if (scriptResponse) {
            const respHeaders: Record<string, string> = {};
            let hasHeader = false;
            for (const [k, v] of Object.entries(scriptResponse.headers)) {
              respHeaders[k] = v;
              hasHeader = true;
            }

            return new Response(out, {
              headers: hasHeader
                ? respHeaders
                : { "Content-Type": "text/html" },
              statusText: scriptResponse.statusText ?? "OK",
              status: scriptResponse.status ?? 200,
            });
          }

          return new Response(out, {
            headers: { "Content-Type": "text/html" },
            statusText: "OK",
            status: 200,
          });
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) {
            return new Response("not found", { status: 404 });
          } else if (e instanceof Error) {
            return new Response(e.message, { status: 500 });
          }
          return new Response("huh:" + e, { status: 500 });
        }
      }
    );
    return abort;
  },
};

const cliHelp = `
Commands
------------------------------------------------------------------

init
| description: initializes or creates your deno.json and a sample page

dev
| description: start development server
| options:
|  --port <port_number>
|  --no-autoreload
|    disables page autoreload

serve
| description: start server for built html files and static assets
| options:
|  --port <port_number>


build
| description: Create html files from .tsx files and copy
| all the static assets. Note, only newer files will be copied.
| options:
|  --force  Force to render and copy all files even if they are older.

Examples
------------------------------------------------------------------
./php.ts build
./php.ts build --force --port 8080
./php.ts dev

# same as above
deno run -A php.ts dev 

Directories
------------------------------------------------------------------

source files: src/
| Put all your .tsx pages in here, other files like images
| and css should also be placed in here.
| Note: Your common files or libraries can be placed outside here.

builld files: build/
| This is where your html files will be written to.

`;

async function main() {
  const { _: args, ...options } = parseArgs(Deno.args);
  const command = args[0];
  if (!command || options.help || options.h) {
    console.log(cliHelp.trim());
    Deno.exit(0);
  }

  let port = parseInt(options.port, 10);
  if (isNaN(port)) port = defaultPort;

  pageAutoReload = command === "dev" && !options["no-autoreload"];

  switch (command) {
    case "build": {
      runner.buildAll(!!(options.force_build || options.f));
      break;
    }

    case "dev": {
      runner.serveDev(port);
      break;
    }

    case "serve": {
      runner.serve(port);
      break;
    }

    case "clean": {
      Deno.removeSync(buildDir, { recursive: true });
      console.log("cleaned", buildDir);
      break;
    }

    case "init": {
      if (!existsSync("./php.ts")) {
        const filename = "php.ts";
        const data = await fetch(import.meta.url);
        const file = await Deno.open(filename, {
          create: true,
          truncate: true,
          write: true,
        });
        data.body?.pipeTo(file.writable);
        Deno.chmod(filename, 0o755);
        console.log("created file:", filename);
      }

      const vscodeSettingsFile = ".vscode/settings.json";

      ensureFileSync(vscodeSettingsFile);
      let vscodeSettings: any = {};
      try {
        vscodeSettings = JSON.parse(Deno.readTextFileSync(vscodeSettingsFile));
      } catch (e) {
        /* do nothing */
      }
      vscodeSettings["deno.enable"] = true;
      Deno.writeTextFileSync(
        vscodeSettingsFile,
        JSON.stringify(vscodeSettings, null, 2)
      );
      console.log("enabled deno on", vscodeSettingsFile);

      let configFile = "deno.jsonc";
      if (existsSync("deno.json")) {
        configFile = "deno.json";
      }

      let config: any = {};
      try {
        config = JSON.parse(Deno.readTextFileSync(configFile));
      } catch (e) {
        /* do nothing */
      }

      if (!config.imports) config.imports = {};
      if (!config.compilerOptions) config.compilerOptions = {};
      if (!config.compilerOptions.lib) config.compilerOptions.lib = [];

      config.imports["$base/"] = "./";

      config.compilerOptions.jsx = "react";
      config.compilerOptions.jsxFactory = "$.createElement";
      config.compilerOptions.jsxFragmentFactory = "$.createFragment";

      const { lib } = config.compilerOptions;
      if (lib.indexOf("dom") < 0) lib.push("dom");
      if (lib.indexOf("deno.window") < 0) lib.push("deno.window");

      Deno.writeTextFileSync(configFile, JSON.stringify(config, null, 2));
      console.log("Created or updated", configFile);

      Deno.mkdirSync(srcDir, { recursive: true });
      const indexFile = srcDir + "/index.tsx";
      if (!existsSync(indexFile)) {
        Deno.writeTextFileSync(
          indexFile,
          `import { $ } from "$base/php.ts";
           $(<marquee style="font-size: 50px">ready for takeoff</marquee>);`
            .split("\n")
            .map((l) => l.trim())
            .join("\n")
        );
        console.log("created file", indexFile);
      }

      break;
    }

    case "run": {
      const abortController = runner.serveDev(defaultPort, false);
      if (args.length == 1) {
        console.log(
          "usage: ",
          basename(import.meta.url),
          "run",
          "<page.tsx>",
          "...[other page files]"
        );
      } else if (args.length === 2) {
        await runner.runScript(args[1].toString());
      } else {
        for (const filename of args.slice(1)) {
          if (!existsSync(filename.toString())) {
            console.log("file not found:", filename.toString());
            continue;
          }

          console.log(
            `-------------------- output of ${filename} --------------------`
          );
          await runner.runScript(filename.toString());
        }
      }
      abortController.abort();
      break;
    }

    default: {
      console.log("invalid command:", command);
    }
  }
}

if (import.meta.main) {
  main();
} else if (Deno.env.has("PHP_TS_RENDER")) {
  await common.loadRequestData();

  globalThis.addEventListener("unload", () => {
    console.log(scriptOutputDelimiter);
    console.log(JSON.stringify($.response));
  });
}
