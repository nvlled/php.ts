import { $ } from "$base/php.ts";
import { Layout } from "./common.tsx";

const { request } = $;

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
    <form>
      Enter your name: <input name="name" value={request.data.name ?? ""} />
    </form>

    <br />
    <a data-no-render href="index.tsx?name=Ouran">
      this link will not show on build
    </a>
    <br />
    <a href="index.tsx?name=Kadode">this link will show on build</a>
    <br />
    <br />
  </Layout>
);
