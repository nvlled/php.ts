import { $ } from "$base/php.ts";
import { createStyle } from "$base/css.tsx";
import { Layout } from "./common.tsx";

const css = createStyle({ scoped: true });
const { request } = $;

// these are optional
$.response.status = 203;
$.response.statusText = "Okay";
$.response.headers["Content-Type"] = "text/html";

$(
  <Layout>
    <p>Here's an unrelated image.</p>
    <div style={{ position: "relative" }}>
      <h1
        style={{
          textAlign: "center",
          width: "100%",
          position: "absolute",
          top: "0",
          color: "#425192",
        }}
      >
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
    <div id={css.id}>
      some blue box &nbsp;
      <div className="box" />
      {css`
        $base {
          display: flex;
          align-items: center;
        }
        $base .box {
          width: 50px;
          height: 50px;
          background: blue;
          display: inline-block;
        }
      `}
    </div>
    <div className="box">{/* this one will not be styled */}</div>
  </Layout>
);
