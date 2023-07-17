import { $, JSXChildren, h } from "../php.ts";

function Layout({ children }: { children: JSXChildren }) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <link rel="stylesheet" href="style.css" />
      </head>
      <body>
        <h1>Example page with php.ts</h1>
        <div className="contents">{children}</div>
      </body>
    </html>
  );
}

$(
  <Layout>
    <p>Here's an unrelated image.</p>
    <img src="images/helck.png" />
  </Layout>
);
