/**
 * Language Registry - Information about supported languages
 */

export interface LanguageFeatures {
  stdin: boolean;
  file_io: boolean;
  networking: boolean;
  subprocess: boolean;
}

export interface LanguageInfo {
  [key: string]: unknown;
  id: string;
  name: string;
  version: string;
  description: string;
  aliases: string[];
  compile_time_ms: number;
  memory_limit_mb: number;
  cpu_limit: number;
  timeout_ms: number;
  features: LanguageFeatures;
  example: string;
  compiler_flags_default?: string;
  compiler_flags_allowed?: string[];
}

export const LANGUAGES: Record<string, LanguageInfo> = {
  python: {
    id: "python",
    name: "Python",
    version: "3.12",
    description: "Python 3.12 with standard library",
    aliases: ["py", "python3"],
    compile_time_ms: 0,
    memory_limit_mb: 64,
    cpu_limit: 0.5,
    timeout_ms: 2000,
    features: {
      stdin: true,
      file_io: false,
      networking: false,
      subprocess: false,
    },
    example: "print(\"Hello, World!\")",
  },
  c: {
    id: "c",
    name: "C",
    version: "GCC 13",
    description: "C with GCC 13 compiler (-O2 optimization)",
    aliases: ["gcc"],
    compile_time_ms: 1000,
    memory_limit_mb: 64,
    cpu_limit: 0.5,
    timeout_ms: 2000,
    features: {
      stdin: true,
      file_io: false,
      networking: false,
      subprocess: false,
    },
    compiler_flags_default: "-O2",
    compiler_flags_allowed: ["-O0", "-O1", "-O2", "-O3", "-Wall", "-Werror"],
    example: `#include <stdio.h>
int main() {
  printf("Hello, World!\\n");
  return 0;
}`,
  },
  java: {
    id: "java",
    name: "Java",
    version: "21",
    description: "Java 21 with standard libraries",
    aliases: ["java", "java21"],
    compile_time_ms: 0,
    memory_limit_mb: 128,
    cpu_limit: 1,
    timeout_ms: 8000,
    features: {
      stdin: true,
      file_io: false,
      networking: false,
      subprocess: false,
    },
    example: "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, World!\");\n    }\n}\n",
  },
  cpp: {
    id: "cpp",
    name: "C++",
    version: "C++17 (GCC 13)",
    description: "C++ with GCC 13 compiler (-O2 -std=c++17 optimization)",
    aliases: ["cpp", "c++"],
    compile_time_ms: 1000,
    memory_limit_mb: 64,
    cpu_limit: 0.5,
    timeout_ms: 2000,
    features: {
      stdin: true,
      file_io: false,
      networking: false,
      subprocess: false,
    },
    compiler_flags_default: "-O2 -std=c++17 -pipe",
    compiler_flags_allowed: ["-O0", "-O1", "-O2", "-O3", "-Wall", "-Werror", "-std=c++17", "-pipe"],
    example: "#include <iostream>\\n\\nint main() {\\n    std::cout << \"Hello, World!\" << std::endl;\\n    return 0;\\n}",
  },
};

/**
 * Get language by ID or alias
 */
export function getLanguage(lang: string | null | undefined): LanguageInfo | null {
  if (!lang) return null;
  const raw = String(lang).toLowerCase();
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPlus = raw.replace(/ /g, "+").trim();

  // Check withPlus first for aliases like c++ where URL query params decode + as space
  if (withPlus !== trimmed) {
    if (LANGUAGES[withPlus]) return LANGUAGES[withPlus];
    for (const [, langInfo] of Object.entries(LANGUAGES)) {
      if (langInfo.aliases && langInfo.aliases.includes(withPlus)) {
        return langInfo;
      }
    }
  }

  // Direct match
  if (LANGUAGES[trimmed]) return LANGUAGES[trimmed];

  // Check aliases
  for (const [, langInfo] of Object.entries(LANGUAGES)) {
    if (langInfo.aliases && langInfo.aliases.includes(trimmed)) {
      return langInfo;
    }
  }

  return null;
}

/**
 * Get all supported languages
 */
export function getAllLanguages(): LanguageInfo[] {
  return Object.values(LANGUAGES);
}

/**
 * Validate language is supported
 */
export function isLanguageSupported(lang: string | null | undefined): boolean {
  return getLanguage(lang) !== null;
}

/**
 * Get language by ID or alias
 * Alias for getLanguage() for compatibility
 */
export function getLanguageById(lang: string | null | undefined): LanguageInfo | null {
  return getLanguage(lang);
}
