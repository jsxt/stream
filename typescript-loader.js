import fs from 'fs';
import ts from 'typescript';

function isURL(string) {
    try {
        new URL(string);
        return true;
    } catch {
        return false;
    }
}

const compilerOptions = {
    compilerOptions: {
        target: 'esnext',
        module: 'esnext',
        isolatedModules: true,
        inlineSourceMap: true,
    },
};

export async function getSource(urlString, context, getSourceDefault) {
    if (isURL(urlString)) {
        const url = new URL(urlString);
        if (url.pathname.endsWith('.js') && !fs.existsSync(url)) {
            url.pathname = url.pathname.replace(/\.js$/u, '.ts');
            const contents = await fs.promises.readFile(url, 'utf8');
            return {
                source: ts.transpileModule(contents, compilerOptions)
                    .outputText,
            };
        }
    }
    return getSourceDefault(urlString, context, getSourceDefault);
}

export async function resolve(specifier, context, defaultResolve) {
    try {
        const defaultResolution = defaultResolve(specifier, context, defaultResolve);
    
        try {
            const url = new URL(defaultResolution.url);
            url.pathname = url.pathname.replace(/\.ts$/, '.js');
            return { url: url.href };
        } catch {
            return defaultResolution;
        }
    } catch {
        return { url: new URL(specifier, context.parentURL).href };
    }
}
