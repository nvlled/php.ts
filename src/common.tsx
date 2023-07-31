import { $ } from "$base/php.ts";
export function Layout({ children }: { children: $.JSXChildren }) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
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
        <div className="contents">{children}</div>
      </body>
    </html>
  );
}
