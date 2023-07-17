#!/usr/bin/env -S deno run -A

import {
  ComponentChildren,
  Fragment,
  h,
  toString as renderToString,
} from "https://deno.land/x/jsx_to_string@v0.1.2/mod.ts";

import { ensureFileSync } from "https://deno.land/std@0.193.0/fs/ensure_file.ts";
import { walkSync } from "https://deno.land/std@0.193.0/fs/walk.ts";
import { extname } from "https://deno.land/std@0.193.0/path/mod.ts";
import { parse as parseArgs } from "https://deno.land/std@0.193.0/flags/mod.ts";

const defaultPort = 3000;

let bufferedOutput = "";
let isOutputBuffered = false;

export { Fragment, h };

export type JSXElem = JSX.Element;

export type JSXChildren = ComponentChildren;

export async function renderPage(
  page: JSX.Element | Promise<JSX.Element>
): Promise<string> {
  page = await Promise.resolve(page);
  return renderToString(page);
}

export async function $(page: JSX.Element | Promise<JSX.Element>) {
  page = await Promise.resolve(page);
  const output = renderToString(page);
  if (isOutputBuffered) {
    bufferedOutput = output;
  } else {
    console.log(output);
  }
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

  renderToString(pageFilename: string) {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", pageFilename],
      env: { NO_COLOR: "1" },
    });

    const { stderr, stdout } = command.outputSync();
    const dec = new TextDecoder();
    return { out: dec.decode(stdout), err: dec.decode(stderr) };
  },

  renderToFile(pageFilename: string, destPath: string) {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", pageFilename],
      env: { NO_COLOR: "1" },
    });

    const { stdout, stderr } = command.outputSync();

    if (stdout.length > 0) {
      Deno.writeFile(destPath, stdout);
    } else {
      console.log("no output", destPath);
    }

    if (stderr.length > 0) {
      console.log(pageFilename, "output");
      console.log(new TextDecoder().decode(stderr));
      console.log("------------------");
    }
  },

  cleanBuild() {
    console.log("cleaning", outputDir);
    Deno.removeSync(outputDir, { recursive: true });
  },

  buildOne(srcPath: string, noCheck = false) {
    const destPath = common.getDestPath(srcPath);

    if (common.isFileNewer(srcPath, destPath) || noCheck) {
      ensureFileSync(destPath);
      if (extname(srcPath) !== ".tsx") {
        console.log("copy", destPath);
        Deno.copyFileSync(srcPath, destPath);
        return "copied";
      } else {
        console.log("render", destPath);
        runner.renderToFile(srcPath, destPath);
        return "rendered";
      }
    } else {
      return "skipped";
    }
  },

  buildAll(noCheck = false) {
    const result = {
      skipped: 0,
      rendered: 0,
      copied: 0,
    };
    for (const entry of walkSync(srcDir)) {
      if (entry.isDirectory) continue;
      const s = runner.buildOne(entry.path, noCheck);
      result[s]++;
    }
    console.log("build status", result);
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
    Deno.serve({ port, hostname: "0.0.0.0" }, async (req) => {
      try {
        let pathname = new URL(req.url).pathname;
        if (pathname === "/") {
          pathname = "/index.html";
        }

        if (!pathname.endsWith(".html")) {
          const file = await Deno.open(srcDir + pathname, { read: true });
          return new Response(file.readable);
        }

        const filename = common.getSrcPath(srcDir + pathname);
        let { out, err } = runner.renderToString(filename);
        if (err != "") {
          out =
            `<div style='white-space: pre-wrap; font-size: 33px;background: red; color'>ruh-oh\n${err}</div>` +
            out;
        }

        return new Response(out, {
          headers: {
            "Content-Type": "text/html",
          },
        });
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
      runner.buildAll(!!(options.force_build || options.f));
      runner.serve(port);
      break;
    case "render":
      if (args.length <= 2) {
        console.log(runner.renderToString(args[1] + "").out);
      } else {
        for (const filename of args.slice(1)) {
          console.log(
            `-------------------- output of ${filename} --------------------`
          );
          console.log(runner.renderToString(filename + "").out);
        }
      }
      break;
    case "test": {
      await import("./src/index.tsx");
      const mod = await import("./src/index.tsx");
      console.log(mod);
    }
  }
}

if (import.meta.main) {
  main();
}
