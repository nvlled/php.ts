#!/usr/bin/env -S deno run -A

import {
  Fragment,
  h,
  toString as renderToString,
} from "https://deno.land/x/jsx_to_string@v0.3.0/mod.ts";

import { parse as parseArgs } from "https://deno.land/std@0.196.0/flags/mod.ts";
import { ensureFileSync } from "https://deno.land/std@0.196.0/fs/ensure_file.ts";
import { existsSync } from "https://deno.land/std@0.196.0/fs/mod.ts";
import {
  extname,
  basename,
  join,
} from "https://deno.land/std@0.196.0/path/mod.ts";

let rootPath = "/";
const defaultPort = 3000;

const scriptOutputDelimiter = "~~~~~~~[response]~~~~~~\n`";
const watchFsPath = ".watch-fs-events.json";
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

  trimSlashStart(path: string) {
    return path.startsWith("/") ? path.slice(1) : path;
  },
  trimSlashEnd(path: string) {
    return path.endsWith("/") ? path.slice(0, path.length - 1) : path;
  },

  joinPaths(...paths: string[]) {
    return paths.join("/").replaceAll(/\/+/g, "/");
  },

  getStaticPath(href: string, includeHash = false) {
    if (href.endsWith("/")) {
      href += "index.tsx";
    }

    const extIndex = href.indexOf(".tsx");
    if (extIndex < 0) {
      return href;
    }

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
    currentPath: string,
    html: string,
    domParser: DOMParser
  ): [string[], string] {
    const dom = domParser.parseFromString(html, "text/html");
    const result: string[] = [];

    const basePath = (() => {
      const fields = currentPath.split("/");
      fields.pop();
      return fields.join("/");
    })();

    for (const child of Array.from(dom.querySelectorAll("[src],[href]"))) {
      let link = child.getAttribute("src") ?? child.getAttribute("href");

      if (!link) continue;
      if (link.match(/^https?:\/\//)) {
        continue;
      }
      if (child.tagName == "A" && link.includes(".tsx")) {
        result.push(link);
      }

      link = common.joinPaths(rootPath, common.getAbsolutePath(basePath, link));
      link = common.getStaticPath(link, true);

      if (child.hasAttribute("href")) {
        child.setAttribute("href", link);
      } else {
        child.setAttribute("src", link);
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

  getAbsolutePath(basePath: string, targetPath: string) {
    if (targetPath[0] === "/") return targetPath;
    if (!basePath.endsWith("/")) basePath += "/";
    return basePath.endsWith("/")
      ? basePath + targetPath
      : basePath + "/" + targetPath;
  },

  getRelativePath(src: string, dest: string) {
    if (src[0] !== "/") src = "/" + src;
    const npaths = src.split("/").filter(Boolean).length - 1;
    return (
      (npaths >= 1 ? "../".repeat(npaths) : "") +
      (dest[0] === "/" ? dest.slice(1) : dest)
    );
  },

  // This function is a simplified version of https://deno.land/std@0.196.0/fs/walk.ts
  // With some changes:
  // - symlink dirs are always followed
  // - path of symlink files still point to symlink file
  // - symlinkPath added to DirEntry
  // - errors are just logged
  *walkSync(
    root: string,
    maxDepth = 1000
  ): IterableIterator<Deno.DirEntry & { path: string; symlinkPath?: string }> {
    if (maxDepth === 0) return;

    {
      const path = root;
      const name = basename(path);
      const info = Deno.lstatSync(path);
      const symlinkPath = info.isSymlink ? Deno.realPathSync(path) : path;
      yield {
        path,
        name,
        isFile: info.isFile,
        isDirectory: info.isSymlink
          ? Deno.statSync(symlinkPath).isDirectory
          : info.isDirectory,
        isSymlink: info.isSymlink,
        symlinkPath,
      };
    }

    let entries;
    try {
      entries = Deno.readDirSync(root);
    } catch (err) {
      console.log("error while walking directory:", err);
    }
    if (!entries) return;

    for (const entry of entries) {
      const path = join(root, entry.name);
      let { isSymlink, isDirectory } = entry;
      let symlinkPath: string | undefined;

      if (isSymlink) {
        symlinkPath = Deno.realPathSync(path);
        ({ isSymlink, isDirectory } = Deno.lstatSync(symlinkPath));
      }

      if (isDirectory) {
        yield* common.walkSync(path, maxDepth - 1);
      } else {
        yield { path, symlinkPath, ...entry };
      }
    }
  },
};

const runner = {
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

    for (const entry of common.walkSync(srcDir)) {
      const destPath = common.getDestPath(entry.path);

      if (entry.isDirectory && !entry.isSymlink) {
        continue;
      }

      if (!(common.isFileNewer(entry.path, destPath) || noCheck)) {
        console.log("skip", destPath);
        continue;
      }

      if (extname(entry.path) !== ".tsx") {
        console.log("copy", entry.path, destPath);
        if (entry.symlinkPath && entry.isSymlink) {
          if (existsSync(destPath)) Deno.removeSync(destPath);
          Deno.symlinkSync(entry.symlinkPath, destPath);
        } else {
          ensureFileSync(destPath);
          Deno.copyFileSync(entry.path, destPath);
        }

        result["copied"]++;
      } else {
        files.push(entry.path);
      }
    }

    const { DOMParser: LinkedDOMParser } = await import(
      "https://esm.sh/linkedom@0.14.22"
    );

    const domParser = new LinkedDOMParser() as DOMParser;

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
        pathname,
        html,
        domParser
      );

      Deno.writeTextFile(outputFilename, updatedHtml);

      for (let link of links) {
        link = common.joinPaths("/", link);
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
          const pathname = new URL(req.url).pathname;
          if (pathname === "/" + watchFsPath && pageAutoReload) {
            return common.createFsEventResponse();
          }

          let filename = srcDir + pathname;
          const isDir = (await Deno.stat(filename)).isDirectory;
          if (pathname === "/" || isDir) {
            filename = common.joinPaths(srcDir, pathname, "index.tsx");
          }

          if (!filename.endsWith(".html") && !filename.endsWith(".tsx")) {
            const file = await Deno.open(filename, { read: true });
            return new Response(file.readable);
          }

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
var evtSource = new EventSource("/${watchFsPath}");
evtSource.addEventListener("fsevent", function(event) {
  window.location.reload();
});
window.addEventListener("unload", function() { evtSource.close(); })
</script>`;
          }

          if (err != "") {
            out =
              `<div style='white-space: pre-wrap; font-size: 33px;background:red; padding: 5px;'>ruh-oh: ${err}</div>` +
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
|  --root <path> Rewrite local links to be a subpath of <path>
     Example, with "--root /docs", a link to /image/test.png will
     become /docs/image/test.png. Default is /

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

const isPageRender = Deno.env.has("PHP_TS_RENDER");

export async function main() {
  if (isPageRender) {
    throw "main() should not be called from page modules";
  }

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
      if (options.root) {
        rootPath = common.joinPaths("/", options.root);
      }
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
        Deno.writeTextFileSync(
          filename,
          `
#!/usr/bin/env -S deno run -A
import {main} from "php.ts";
main();
        `.trim()
        );
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
      config.imports["php.ts"] = import.meta.url;

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
          `import { $ } from "php.ts";
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
} else if (isPageRender) {
  await common.loadRequestData();

  globalThis.addEventListener("unload", () => {
    console.log(scriptOutputDelimiter);
    console.log(JSON.stringify($.response));
  });
}
