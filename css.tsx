import { $ } from "./php.ts";

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

let counter = 0;

export const createStyle = ({
  scoped = false,
  placeholder = "$base",
}: { scoped?: boolean; placeholder?: string } = {}) => {
  if (!scoped) {
    return cssRaw;
  }

  const id = "comp__" + ++counter;
  const fn = (strings: TemplateStringsArray) => {
    const s = strings.raw.join("");
    return <style>{s.replaceAll(placeholder, "#" + id)}</style>;
  };
  fn.id = id;
  return fn;
};
