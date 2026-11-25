/* 为某个路由生成 500x900 的包裹页，供无头 Edge 截图后裁剪 */
const fs = require('fs');
const path = require('path');
const routes = process.argv.slice(2);

routes.forEach((route) => {
  const name = route.replace(/[?&=]/g, '_');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#F7F3EC;overflow:hidden}
iframe{width:375px;height:812px;border:0;display:block}</style></head>
<body><iframe src="../web/app.html#/${route}"></iframe></body></html>`;
  fs.writeFileSync(path.join(__dirname, `wrap-${name}.html`), html);
});

console.log('wrapped', routes.join(', '));
