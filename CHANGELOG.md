# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial implementation of Braintrust plugin for OpenCode
- Automatic session tracing with hierarchical spans
- Session, turn, and tool span tracking
- Custom tools for Braintrust data access:
  - `braintrust_query_logs` - Execute SQL queries
  - `braintrust_list_projects` - List projects
  - `braintrust_log_data` - Manually log data
  - `braintrust_get_experiments` - View experiments
- Configuration via environment variables
- Debug logging support
- API URL auto-discovery
- Project auto-creation

### Changed
- N/A

### Deprecated
- N/A

### Removed
- N/A

### Fixed
- N/A

### Security
- N/A

## [0.1.0] - TBD

Initial release
