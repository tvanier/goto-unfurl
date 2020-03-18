const gotoUnfurl = require('./goto-unfurl');

const run = async (event) => {
  const resp = await gotoUnfurl.handler(event)
  console.log(resp.body);
}

const event = {
  path: process.argv[2]
}

run(event);
