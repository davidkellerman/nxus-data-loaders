module.exports = {
  "plugins": ["@babel/plugin-proposal-object-rest-spread"],
  "presets": [
    ["@babel/preset-env", {
      "targets": {"browsers": "> 0.25% in US, not IE <= 11, not android <= 4.4.3, not ios_saf <= 10.3"},
      "modules": false
    }]
  ],
  "env": {
    "test": {
      "plugins": ["@babel/plugin-transform-modules-commonjs"]
    }
  }
}
