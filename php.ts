#!/usr/bin/env -S deno run -A

import {
  ComponentChildren as JSXChildren,
  Fragment,
  h,
  toString as renderToString,
} from "https://deno.land/x/jsx_to_string@v0.1.2/mod.ts";

import { ensureFileSync } from "https://deno.land/std@0.193.0/fs/ensure_file.ts";
import { walkSync } from "https://deno.land/std@0.193.0/fs/walk.ts";
import { extname } from "https://deno.land/std@0.193.0/path/mod.ts";
import { parse as parseArgs } from "https://deno.land/std@0.193.0/flags/mod.ts";

const defaultPort = 3000;

export { h, Fragment };
export type { JSXChildren };

export async function renderPage(
  page: JSX.Element | Promise<JSX.Element>
): Promise<string> {
  page = await Promise.resolve(page);
  return renderToString(page);
}

export async function $(page: JSX.Element | Promise<JSX.Element>) {
  page = await Promise.resolve(page);
  const output = renderToString(page);
  console.log(output);
}

const scriptOutputDelimiter = "~~~~~~~[response]~~~~~~\n`";

// deno-lint-ignore no-namespace
export namespace $ {
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
const outputDir = "build";

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
    return outputDir + "/" + fields.slice(1).join("/");
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
    } catch (e) {
      console.log(e);
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
    console.log("cleaning", outputDir);
    Deno.removeSync(outputDir, { recursive: true });
  },

  async buildOne(srcPath: string, noCheck = false) {
    const destPath = common.getDestPath(srcPath);

    if (common.isFileNewer(srcPath, destPath) || noCheck) {
      ensureFileSync(destPath);
      if (extname(srcPath) !== ".tsx") {
        console.log("copy", destPath);
        Deno.copyFileSync(srcPath, destPath);
        return "copied";
      } else {
        console.log("render", destPath);
        if (srcPath.startsWith(srcDir)) {
          srcPath = srcPath.slice(srcDir.length);
        }

        const url = `http://localhost:${defaultPort}${srcPath}`;
        const resp = await fetch(url);
        const f = await Deno.open(destPath, {
          create: true,
          truncate: true,
          write: true,
        });
        await resp.body?.pipeTo(f.writable);

        return "rendered";
      }
    } else {
      return "skipped";
    }
  },

  async buildAll(noCheck = false) {
    const abortController = runner.serveDev(defaultPort);

    const result = {
      skipped: 0,
      rendered: 0,
      copied: 0,
    };
    for (const entry of walkSync(srcDir)) {
      if (entry.isDirectory) continue;
      const s = await runner.buildOne(entry.path, noCheck);
      result[s]++;
    }
    console.log("build status", result);
    abortController.abort();
  },

  serve(port: number) {
    Deno.serve({ port, hostname: "0.0.0.0" }, async (req) => {
      try {
        console.log("serve request", req);
        let pathname = new URL(req.url).pathname;
        if (pathname === "/") {
          pathname = "/index.html";
        }

        const file = await Deno.open(outputDir + pathname, { read: true });
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

  serveDev(port: number) {
    const abort = new AbortController();
    Deno.serve(
      { port, hostname: "0.0.0.0", signal: abort.signal },
      async (req) => {
        try {
          let pathname = new URL(req.url).pathname;
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

          if (err != "") {
            out =
              `<div style='white-space: pre-wrap; font-size: 33px;background: red; color'>ruh-oh\n${err}</div>` +
              out;
          }

          if (scriptResponse) {
            const respHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(scriptResponse.headers)) {
              respHeaders[k] = v;
            }

            return new Response(out, {
              headers: respHeaders,
              statusText: scriptResponse.statusText,
              status: scriptResponse.status,
            });
          }

          return new Response(out);
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

const cli = {
  serve: {
    desc: "start server",
    options: {
      "--port": "port number",
    },
  },
  dev: {
    desc: "start dev server",
    options: {
      "--port": "port number",
    },
  },
  build: {
    desc: "builds all tsx files to html",
    options: {
      "--src": "the source directory",
      "--dest": "the destination directory",
    },
  },
  render: {
    desc: "renders a tsx to stdout",
    args: ["...files"],
  },
};

async function main() {
  const { _: args, ...options } = parseArgs(Deno.args);
  const command = args[0];
  if (!command) {
    console.log(JSON.stringify(cli, null, 2));
    Deno.exit(0);
  }

  let port = parseInt(options.port, 10);
  if (isNaN(port)) port = defaultPort;

  switch (command) {
    case "build":
      runner.buildAll(!!(options.force_build || options.f));
      break;
    case "dev":
      runner.serveDev(port);
      break;
    case "serve":
      runner.serve(port);
      break;

    case "render": {
      // TODO: use serveDev so that the request and response still works
      if (args.length <= 2) {
        console.log((await runner.renderToString(args[1] + "", $.request)).out);
      } else {
        for (const filename of args.slice(1)) {
          console.log(
            `-------------------- output of ${filename} --------------------`
          );
          console.log(
            (await runner.renderToString(filename + "", $.request)).out
          );
        }
      }
      break;
    }

    case "test": {
      await import("./src/index.tsx");
      const mod = await import("./src/index.tsx");
      console.log(mod);
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
