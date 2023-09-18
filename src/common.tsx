import { $ } from "$base/php.ts";
import { getAllCSS } from "https://deno.land/x/stylesith@v0.1.1/mod.ts";

export function Layout({
  id,
  children,
}: {
  id?: string;
  children: JSX.Children;
}) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        {() => <style dangerouslySetInnerHTML={{ __html: getAllCSS() }} />}
        <link rel="stylesheet" href="style.css" />
      </head>
      <body>
        <h1>Example page with php.ts</h1>
        <div>
          <a href="/">home</a>
          &nbsp;
          <a href="about.tsx">about</a>
        </div>
        <hr />
        <div id={id} className="contents">
          {children}
        </div>
      </body>
    </html>
  );
}
