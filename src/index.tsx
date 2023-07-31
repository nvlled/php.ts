import { $ } from "../php.ts";

const { request } = $;

function Layout({ children }: { children: $.JSXChildren }) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <link rel="stylesheet" href="style.css" />
      </head>
      <body>
        <h1>Example page with php.ts</h1>
        <div className="contents">{children}</div>
        <h1 style={{ textAlign: "center" }}>
          {request.data.name && `hello ${request.data.name}`}
        </h1>
        <form>
          Enter your name: <input name="name" />
        </form>
        <br />
        <a data-no-render href="index.tsx?name=Oran">
          this link will not show on build
        </a>
        <br />
        <a href="index.tsx?name=Kadode">this link will show on build</a>
        <br />
        <br />
      </body>
    </html>
  );
}

$.response.status = 203;
$.response.statusText = "Okay";
$.response.headers["Content-Type"] = "text/html";

$(
  <Layout>
    <p>Here's an unrelated image.</p>
    <img src="images/helck.png" />
  </Layout>
);
