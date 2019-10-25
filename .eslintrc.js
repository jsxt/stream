"use strict";
const path = require("path");
const createEslintConfig = require("@jsxt/eslint-config-typescript");

module.exports = createEslintConfig({
    project: path.join(__dirname, "./tsconfig.json"),
});
