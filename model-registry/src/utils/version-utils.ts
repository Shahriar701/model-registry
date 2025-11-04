/**
 * Utility functions for semantic version management
 */

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export class VersionUtils {
  /**
   * Parse a semantic version string into components
   */
  static parseVersion(version: string): SemanticVersion {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
      throw new Error(`Invalid semantic version format: ${version}`);
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  }

  /**
   * Compare two semantic versions
   * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
   */
  static compareVersions(v1: string, v2: string): number {
    const version1 = this.parseVersion(v1);
    const version2 = this.parseVersion(v2);

    if (version1.major !== version2.major) {
      return version1.major > version2.major ? 1 : -1;
    }

    if (version1.minor !== version2.minor) {
      return version1.minor > version2.minor ? 1 : -1;
    }

    if (version1.patch !== version2.patch) {
      return version1.patch > version2.patch ? 1 : -1;
    }

    return 0;
  }

  /**
   * Check if a version is greater than another
   */
  static isGreaterThan(v1: string, v2: string): boolean {
    return this.compareVersions(v1, v2) > 0;
  }

  /**
   * Check if a version is less than another
   */
  static isLessThan(v1: string, v2: string): boolean {
    return this.compareVersions(v1, v2) < 0;
  }

  /**
   * Check if two versions are equal
   */
  static isEqual(v1: string, v2: string): boolean {
    return this.compareVersions(v1, v2) === 0;
  }

  /**
   * Sort an array of version strings in ascending order
   */
  static sortVersionsAscending(versions: string[]): string[] {
    return [...versions].sort((a, b) => this.compareVersions(a, b));
  }

  /**
   * Sort an array of version strings in descending order
   */
  static sortVersionsDescending(versions: string[]): string[] {
    return [...versions].sort((a, b) => this.compareVersions(b, a));
  }

  /**
   * Get the latest version from an array of version strings
   */
  static getLatestVersion(versions: string[]): string | null {
    if (versions.length === 0) {
      return null;
    }

    return versions.reduce((latest, current) => 
      this.isGreaterThan(current, latest) ? current : latest
    );
  }

  /**
   * Check if a version string is valid semantic version
   */
  static isValidSemanticVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(version);
  }

  /**
   * Generate the next patch version
   */
  static getNextPatchVersion(version: string): string {
    const parsed = this.parseVersion(version);
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }

  /**
   * Generate the next minor version
   */
  static getNextMinorVersion(version: string): string {
    const parsed = this.parseVersion(version);
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  /**
   * Generate the next major version
   */
  static getNextMajorVersion(version: string): string {
    const parsed = this.parseVersion(version);
    return `${parsed.major + 1}.0.0`;
  }
}