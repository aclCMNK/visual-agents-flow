/**
 * tests/ui/clone-error-mapper.test.ts
 *
 * Unit tests for Git clone error mapping logic.
 * Tests the error code mapping from git stderr and the UX message mapping.
 *
 * These are pure-logic tests — no DOM, no React, no Electron.
 */

import { describe, it, expect } from "bun:test";

/**
 * Simulates the error mapping logic from ipc-handlers.ts.
 */
function mapGitStderrToErrorCode(stderr: string): string {
  const s = stderr.toLowerCase();
  if (
    s.includes("authentication failed") ||
    s.includes("could not read username") ||
    s.includes("invalid username or password") ||
    s.includes("repository not found") ||
    s.includes("access denied") ||
    s.includes("403") ||
    s.includes("401")
  ) {
    return "AUTH_ERROR";
  }
  if (
    s.includes("could not resolve host") ||
    s.includes("network is unreachable") ||
    s.includes("connection timed out") ||
    s.includes("unable to connect") ||
    s.includes("failed to connect")
  ) {
    return "NETWORK_ERROR";
  }
  if (s.includes("permission denied") || s.includes("read-only file system")) {
    return "IO_ERROR";
  }
  return "UNKNOWN";
}

/**
 * Simulates the UX message mapping from ipc-handlers.ts.
 */
function getCloneErrorMessage(
  errorCode: string,
  details?: { status?: number }
): { message: string; suggestion: string } {
  switch (errorCode) {
    case "AUTH_ERROR": {
      let message = "Autenticación fallida: token o usuario inválido o sin permisos.";
      let suggestion = "Verifique usuario y token; asegúrese que el token tenga permiso \"repo\" o acceso necesario. Pruebe validar token desde la UI.";
      
      if (details?.status === 401) {
        message = "Token inválido.";
        suggestion = "El token proporcionado no es válido. Genere un nuevo token en GitHub con los permisos necesarios.";
      } else if (details?.status === 403) {
        message = "Token sin permisos o rate-limited.";
        suggestion = "El token no tiene permisos 'repo' o ha excedido el límite de solicitudes. Verifique los scopes del token y espere antes de reintentar.";
      }
      
      return { message, suggestion };
    }
    
    case "DEST_EXISTS":
      return {
        message: "Directorio destino ya existe y no está vacío.",
        suggestion: "Elija otro directorio o mueva/borre el existente. Si desea sobreescribir, haga backup manualmente."
      };
      
    case "NETWORK_ERROR":
      return {
        message: "Error de red al intentar clonar.",
        suggestion: "Verifique conexión y proxy. Intente nuevamente."
      };
      
    case "GIT_NOT_FOUND":
      return {
        message: "Git no está instalado (o no encontrado en PATH).",
        suggestion: "Instale Git y reinicie la aplicación."
      };
      
    case "IO_ERROR":
      return {
        message: "Error de disco/permiso al escribir en el destino.",
        suggestion: "Verifique permisos del directorio de destino y espacio en disco."
      };
      
    case "CONCURRENT_LIMIT":
      return {
        message: "Límite de clones simultáneos alcanzado.",
        suggestion: "Espere a que termine un clonado en curso o cancele uno activo."
      };
      
    case "INVALID_URL":
      return {
        message: "URL de repositorio inválida.",
        suggestion: "Ingrese una URL válida de GitHub, GitLab o Bitbucket."
      };
      
    case "UNKNOWN":
    default:
      return {
        message: "Error desconocido al clonar.",
        suggestion: "Revise detalles técnicos en los logs (sanitizados) y contacte soporte si persiste."
      };
  }
}

// ── mapGitStderrToErrorCode ────────────────────────────────────────────────

describe("mapGitStderrToErrorCode — AUTH_ERROR cases", () => {
  const authErrorCases = [
    "fatal: Authentication failed for 'https://github.com/org/repo.git/'",
    "remote: Invalid username or password.",
    "error: could not read Username for 'https://github.com': terminal prompts disabled",
    "remote: Repository not found.",
    "remote: Access denied",
    "fatal: unable to access 'https://github.com/org/repo.git/': The requested URL returned error: 403",
    "fatal: unable to access 'https://github.com/org/repo.git/': The requested URL returned error: 401",
    "ERROR: Repository not found. fatal: Could not read from remote repository.",
  ];

  for (const stderr of authErrorCases) {
    it(`maps "${stderr.substring(0, 50)}..." to AUTH_ERROR`, () => {
      const result = mapGitStderrToErrorCode(stderr);
      expect(result).toBe("AUTH_ERROR");
    });
  }
});

describe("mapGitStderrToErrorCode — NETWORK_ERROR cases", () => {
  const networkErrorCases = [
    "fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host: github.com",
    "error: Could not resolve host: gitlab.com",
    "fatal: unable to access 'https://github.com/org/repo.git/': Network is unreachable",
    "fatal: unable to access 'https://github.com/org/repo.git/': Connection timed out",
    "error: unable to connect to github.com: Connection refused",
    "fatal: failed to connect to github.com port 443: Connection refused",
  ];

  for (const stderr of networkErrorCases) {
    it(`maps "${stderr.substring(0, 50)}..." to NETWORK_ERROR`, () => {
      const result = mapGitStderrToErrorCode(stderr);
      expect(result).toBe("NETWORK_ERROR");
    });
  }
});

describe("mapGitStderrToErrorCode — IO_ERROR cases", () => {
  const ioErrorCases = [
    "error: open('/path/to/repo/.git/HEAD'): Permission denied",
    "fatal: could not create work tree dir '/path/to/repo': Permission denied",
    "error: Read-only file system",
    "fatal: unable to write to '/path/to/repo/.git/objects': Permission denied",
  ];

  for (const stderr of ioErrorCases) {
    it(`maps "${stderr.substring(0, 50)}..." to IO_ERROR`, () => {
      const result = mapGitStderrToErrorCode(stderr);
      expect(result).toBe("IO_ERROR");
    });
  }
});

describe("mapGitStderrToErrorCode — UNKNOWN cases", () => {
  const unknownCases = [
    "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
    "error: Your local changes to the following files would be overwritten by checkout:",
    "warning: templates not found /usr/share/git-core/templates",
    "Some random error message",
    "",
  ];

  for (const stderr of unknownCases) {
    it(`maps "${stderr.substring(0, 50)}..." to UNKNOWN`, () => {
      const result = mapGitStderrToErrorCode(stderr);
      expect(result).toBe("UNKNOWN");
    });
  }
});

describe("mapGitStderrToErrorCode — case insensitive", () => {
  it("handles mixed case in error messages", () => {
    expect(mapGitStderrToErrorCode("AUTHENTICATION FAILED")).toBe("AUTH_ERROR");
    expect(mapGitStderrToErrorCode("Authentication Failed")).toBe("AUTH_ERROR");
    expect(mapGitStderrToErrorCode("permission DENIED")).toBe("IO_ERROR");
    expect(mapGitStderrToErrorCode("Permission Denied")).toBe("IO_ERROR");
  });
});

// ── getCloneErrorMessage ───────────────────────────────────────────────────

describe("getCloneErrorMessage — AUTH_ERROR", () => {
  it("returns default auth error message", () => {
    const result = getCloneErrorMessage("AUTH_ERROR");
    
    expect(result.message).toBe("Autenticación fallida: token o usuario inválido o sin permisos.");
    expect(result.suggestion).toContain("Verifique usuario y token");
  });

  it("returns 401-specific message", () => {
    const result = getCloneErrorMessage("AUTH_ERROR", { status: 401 });
    
    expect(result.message).toBe("Token inválido.");
    expect(result.suggestion).toContain("El token proporcionado no es válido");
  });

  it("returns 403-specific message", () => {
    const result = getCloneErrorMessage("AUTH_ERROR", { status: 403 });
    
    expect(result.message).toBe("Token sin permisos o rate-limited.");
    expect(result.suggestion).toContain("El token no tiene permisos 'repo'");
  });
});

describe("getCloneErrorMessage — DEST_EXISTS", () => {
  it("returns destination exists message", () => {
    const result = getCloneErrorMessage("DEST_EXISTS");
    
    expect(result.message).toBe("Directorio destino ya existe y no está vacío.");
    expect(result.suggestion).toContain("Elija otro directorio");
  });
});

describe("getCloneErrorMessage — NETWORK_ERROR", () => {
  it("returns network error message", () => {
    const result = getCloneErrorMessage("NETWORK_ERROR");
    
    expect(result.message).toBe("Error de red al intentar clonar.");
    expect(result.suggestion).toContain("Verifique conexión y proxy");
  });
});

describe("getCloneErrorMessage — GIT_NOT_FOUND", () => {
  it("returns git not found message", () => {
    const result = getCloneErrorMessage("GIT_NOT_FOUND");
    
    expect(result.message).toBe("Git no está instalado (o no encontrado en PATH).");
    expect(result.suggestion).toBe("Instale Git y reinicie la aplicación.");
  });
});

describe("getCloneErrorMessage — IO_ERROR", () => {
  it("returns IO error message", () => {
    const result = getCloneErrorMessage("IO_ERROR");
    
    expect(result.message).toBe("Error de disco/permiso al escribir en el destino.");
    expect(result.suggestion).toContain("Verifique permisos del directorio");
  });
});

describe("getCloneErrorMessage — CONCURRENT_LIMIT", () => {
  it("returns concurrent limit message", () => {
    const result = getCloneErrorMessage("CONCURRENT_LIMIT");
    
    expect(result.message).toBe("Límite de clones simultáneos alcanzado.");
    expect(result.suggestion).toContain("Espere a que termine un clonado en curso");
  });
});

describe("getCloneErrorMessage — INVALID_URL", () => {
  it("returns invalid URL message", () => {
    const result = getCloneErrorMessage("INVALID_URL");
    
    expect(result.message).toBe("URL de repositorio inválida.");
    expect(result.suggestion).toContain("Ingrese una URL válida");
  });
});

describe("getCloneErrorMessage — UNKNOWN", () => {
  it("returns unknown error message", () => {
    const result = getCloneErrorMessage("UNKNOWN");
    
    expect(result.message).toBe("Error desconocido al clonar.");
    expect(result.suggestion).toContain("Revise detalles técnicos");
  });

  it("returns unknown for invalid error code", () => {
    const result = getCloneErrorMessage("INVALID_CODE" as any);
    
    expect(result.message).toBe("Error desconocido al clonar.");
    expect(result.suggestion).toContain("Revise detalles técnicos");
  });
});

// ── Integration: Full error flow ───────────────────────────────────────────

describe("Error mapping integration", () => {
  it("simulates complete error flow from git stderr to UX message", () => {
    // Simulate git clone failing with authentication error
    const gitStderr = "fatal: Authentication failed for 'https://github.com/org/private.git/'";
    
    // Step 1: Map git stderr to error code
    const errorCode = mapGitStderrToErrorCode(gitStderr);
    expect(errorCode).toBe("AUTH_ERROR");
    
    // Step 2: Map error code to UX message
    const uxMessage = getCloneErrorMessage(errorCode);
    expect(uxMessage.message).toBe("Autenticación fallida: token o usuario inválido o sin permisos.");
    expect(uxMessage.suggestion).toContain("Verifique usuario y token");
  });

  it("simulates network error flow", () => {
    const gitStderr = "fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host: github.com";
    
    const errorCode = mapGitStderrToErrorCode(gitStderr);
    expect(errorCode).toBe("NETWORK_ERROR");
    
    const uxMessage = getCloneErrorMessage(errorCode);
    expect(uxMessage.message).toBe("Error de red al intentar clonar.");
    expect(uxMessage.suggestion).toContain("Verifique conexión y proxy");
  });

  it("simulates permission error flow", () => {
    const gitStderr = "error: open('/path/to/repo/.git/HEAD'): Permission denied";
    
    const errorCode = mapGitStderrToErrorCode(gitStderr);
    expect(errorCode).toBe("IO_ERROR");
    
    const uxMessage = getCloneErrorMessage(errorCode);
    expect(uxMessage.message).toBe("Error de disco/permiso al escribir en el destino.");
    expect(uxMessage.suggestion).toContain("Verifique permisos del directorio");
  });

  it("simulates GitHub API 403 error flow", () => {
    // This would come from GitHub API validation, not git
    const errorCode = "AUTH_ERROR";
    const uxMessage = getCloneErrorMessage(errorCode, { status: 403 });
    
    expect(uxMessage.message).toBe("Token sin permisos o rate-limited.");
    expect(uxMessage.suggestion).toContain("El token no tiene permisos 'repo'");
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("handles empty stderr", () => {
    const result = mapGitStderrToErrorCode("");
    expect(result).toBe("UNKNOWN");
  });

  it("handles stderr with only whitespace", () => {
    const result = mapGitStderrToErrorCode("   \n\t  ");
    expect(result).toBe("UNKNOWN");
  });

  it("handles very long stderr", () => {
    const longStderr = "a".repeat(10000) + "authentication failed" + "b".repeat(10000);
    const result = mapGitStderrToErrorCode(longStderr);
    expect(result).toBe("AUTH_ERROR");
  });

  it("prioritizes first matching pattern (AUTH over NETWORK)", () => {
    const stderr = "authentication failed and could not resolve host";
    const result = mapGitStderrToErrorCode(stderr);
    expect(result).toBe("AUTH_ERROR");
  });

  it("handles multiple error patterns in same message", () => {
    const stderr = "Permission denied (read-only file system)";
    const result = mapGitStderrToErrorCode(stderr);
    expect(result).toBe("IO_ERROR");
  });
});