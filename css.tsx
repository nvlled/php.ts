/** @jsx h */
import { h } from "https://deno.land/x/jsx_to_string@v0.3.0/mod.ts";

const cssRaw = (strings: TemplateStringsArray) => strings.raw.join("");
cssRaw.id = "";

/*
Example usage: 

const css = createStyle({ scoped: true });
const elem = <div id={css.id}>
    blue box:
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

$base will replaced with a generated ID.
If {scoped:false}, then css just returns the string parameter as is.
</div>
*/
export const createStyle = ({
  scoped = false,
  placeholder = "$base",
}: { scoped?: boolean; placeholder?: string } = {}) => {
  if (!scoped) {
    return cssRaw;
  }

  const id = "comp__" + Date.now().toString(36);
  const fn = (strings: TemplateStringsArray) => {
    const s = strings.raw.join("");
    return <style>{s.replaceAll(placeholder, "#" + id)}</style>;
  };
  fn.id = id;
  return fn;
};
