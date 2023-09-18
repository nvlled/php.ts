import { $ } from "$base/php.ts";
import { Layout } from "./common.tsx";
import { createCSS } from "https://deno.land/x/stylesith@v0.1.1/mod.ts";

const css = createCSS();
const { request } = $;

// these are optional
$.response.status = 203;
$.response.statusText = "Okay";
$.response.headers["Content-Type"] = "text/html";

$(
  <Layout id={css.id}>
    {css`
      #x .greeting {
        text-align: center;
        width: 100%;
        position: absolute;
        top: 0;
        color: #425192;
      }
    `}
    <div>script file: {$.request.src}</div>
    <div>tailwind block</div>
    <p>Here's an unrelated image.</p>
    <div style={{ position: "relative" }}>
      <h1 className="greeting">
        {request.data.name && `Hey ${request.data.name}`}
      </h1>
      <img src="images/helck.png" />
    </div>
    <form style={{ textAlign: "center" }}>
      Enter your name: <input name="name" value={request.data.name ?? ""} />
    </form>

    <br />
    <a data-no-render href="index.tsx?name=Ouran">
      this link will not work on build
    </a>
    <br />
    <a href="index.tsx?name=Kadode">this link will work on build</a>
    <br />
    <br />
  </Layout>
);
