const ts = () => new Date().toISOString();
// Set up error handlers to prevent EPIPE crashes
process.stdout.on('error', () => { });
process.stderr.on('error', () => { });
const safeWrite = (data) => {
    try {
        process.stdout.write(data + '\n');
    }
    catch (error) {
        // Ignore write errors
    }
};
const safeWriteError = (data) => {
    try {
        process.stderr.write(data + '\n');
    }
    catch (error) {
        // Ignore write errors
    }
};
export const logger = {
    info: (msg) => safeWrite(`[${ts()}] INFO  ${msg}`),
    success: (msg) => safeWrite(`[${ts()}] OK    ${msg}`),
    warn: (msg) => safeWriteError(`[${ts()}] WARN  ${msg}`),
    error: (msg, err) => {
        safeWriteError(`[${ts()}] ERROR ${msg}`);
        if (err instanceof Error)
            safeWriteError(`       ${err.message}`);
    },
};
