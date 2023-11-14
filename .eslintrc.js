module.exports = {
    env: {
        es2021: true,
        node: true
    },
    extends: 'eslint:recommended',
    overrides: [
        {
            files: [
                '.eslintrc.{js,cjs}'
            ]
        }
    ],
    globals: {
        Titanium: "readonly",
        Ti: "readonly"
    },
    rules: {
        indent: [
            'error',
            4
        ],
        'linebreak-style': [
            'error',
            'unix'
        ],
        quotes: [
            'error',
            'single'
        ],
        semi: [
            'error',
            'always'
        ]
    }
};
