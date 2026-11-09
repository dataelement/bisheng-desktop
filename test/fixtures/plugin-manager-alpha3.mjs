// Verbatim alpha.3 install/change methods and minimal declaration anchors. Pure test data only.
export const pluginManagerAlpha3Source = String.raw`class AlphaManager {
		static inject = ["loader", "profileContext"];
		installBundle(spec, options) {
			const requestId = options?.requestId;
			const control = {
				abort: new AbortController(),
				phase: "installing",
				result: Promise.resolve(null)
			};
			const stopped = () => control.abort.signal.aborted || this.abort.signal.aborted;
			if (requestId !== void 0) this.installs.set(requestId, control);
			const announce = (phase, attempt) => {
				if (requestId !== void 0) this.ownerContext.emit("plugin-manager/install-state", {
					requestId,
					phase,
					...attempt === void 0 ? {} : { attempt }
				});
			};
			const result = this.change(async (result) => {
				if (spec.trim() === "" || spec.startsWith("-")) throw new ManagementFailure("invalid-spec");
				if (stopped()) throw new InstallCancelledError();
				const before = readProfileManifest("dsh", this.profile.dir).dependencies ?? {};
				const known = specPackageName(spec, before, this.profile.dir);
				if (this.ownerContext.get("hmr") !== void 0 && known !== void 0 && Object.hasOwn(before, known)) throw new ManagementFailure("already-installed");
				if (options?.approvedBuilds !== void 0) {
					await approveBuilds(this.profile.dir, options.approvedBuilds);
					result.approvedBuilds = options.approvedBuilds;
				}
				const files = await this.readRestoredFiles();
				let name;
				let version;
				try {
					result.registries = [];
					const parsed = parsedForRegistry(spec);
					const signal = AbortSignal.any([this.abort.signal, control.abort.signal]);
					const env = this.profile.packageManager?.env === void 0 ? {} : { env: this.profile.packageManager.env };
					const connection = checkGithubConnection(parsed, this.profile.dir, {
						timeoutMs: this.githubConnectionTimeoutMs,
						outputBytes: this.outputBytes,
						signal,
						...env
					});
					this.packageOperations.add(connection);
					let connectionFailure;
					try {
						connectionFailure = await connection;
					} finally {
						this.packageOperations.delete(connection);
					}
					if (stopped()) throw new InstallCancelledError();
					if (connectionFailure?.kind === "network" || connectionFailure?.kind === "timeout") {
						const { argv, ...packageResult } = connectionFailure;
						result.packageResult = packageResult;
						result.failedAt = "spec-host";
						if (requestId !== void 0) this.ownerContext.emit("plugin-manager/install-log", {
							requestId,
							jobId: randomUUID(),
							argv,
							cwd: this.profile.dir,
							stream: "stderr",
							text: connectionFailure.output,
							exitCode: connectionFailure.timedOut === true ? null : connectionFailure.exitCode
						});
						throw new Error(connectionFailure.output);
					}
					const transport = chooseGitTransport(parsed, this.profile.dir, {
						timeoutMs: this.gitTransportTimeoutMs,
						signal,
						...env
					});
					this.packageOperations.add(transport);
					let installSpec;
					try {
						installSpec = await transport;
					} finally {
						this.packageOperations.delete(transport);
					}
					if (stopped()) throw new InstallCancelledError();
					const plan = registryPlan(options?.registry, await this.registries());
					let run;
					let used = null;
					for (const [index, registry] of plan.entries()) {
						if (index > 0) await this.restoreFiles(files);
						if (stopped()) throw new InstallCancelledError();
						result.registries.push(registry);
						used = registry;
						announce("installing", {
							registry,
							index: index + 1,
							total: plan.length
						});
						run = await this.runPnpm([
							"add",
							installSpec,
							...options?.saveExact === true ? ["--save-exact"] : [],
							...registryArguments(registry)
						], control.abort.signal, requestId);
						result.packageResult = run;
						if (stopped()) throw new InstallCancelledError();
						if (run.incompatible !== void 0) throw new ManagementFailure("incompatible-version", run.incompatible);
						if (run.exitCode === 0 && run.timedOut !== true) break;
						/* v8 ignore next 2 -- runPnpm classifies every run it does not report as succeeded */
						if (run.kind === void 0) break;
						delete result.failedAt;
						if (run.timedOut === true) break;
						const failedAt = attributeFailure(run.kind, run.output, parsedForRegistry(installSpec));
						if (failedAt !== "other") result.failedAt = failedAt;
						if (failedAt !== "registry" || index === plan.length - 1) break;
					}
					/* v8 ignore next -- the plan is never empty, so a run always settled */
					if (run === void 0) throw new Error("no registry was asked");
					const succeeded = run.exitCode === 0 && run.timedOut !== true;
					if (succeeded) delete result.failedAt;
					if (!succeeded) {
						try {
							result.pendingBuilds = await recordPendingBuilds(this.profile.dir, run.output);
						} catch (error) {
							this.ownerContext.logger.warn("Could not read pending build approvals after pnpm failed", error);
						}
						throw new Error(run.output);
					}
					const after = readProfileManifest("dsh", this.profile.dir).dependencies ?? {};
					const installed = Object.keys(after).filter((name) => before[name] !== after[name]);
					if (installed.length === 0) {
						const local = specPackageName(spec, after, this.profile.dir);
						if (local !== void 0 && Object.hasOwn(after, local)) installed.push(local);
					}
					const target = installed[0];
					if (installed.length !== 1 || target === void 0) throw new ManagementFailure("ambiguous-install");
					name = target;
					const dir = resolveBundleDir("dsh", name, this.profile.installAnchor, this.profile.dir);
					const manifest = bundleManifest(name, this.profile.dir, this.profile.installAnchor);
					if (manifest?.dsh?.bundle === void 0) throw new ManagementFailure("not-bundle");
					const compatibility = evaluatePluginCompatibility(manifest, readProfileVersionExemptions(this.profile.dir));
					if (compatibility !== void 0 && !compatibility.exempted) throw new ManagementFailure("incompatible-version", [incompatiblePlugin(compatibility)]);
					for (const file of bundlePatchPaths(dir, manifest.dsh.bundle)) loadOverlayPatches("dsh", file);
					version = manifest.version;
					this.installedFrom.set(name, used);
				} catch (error) {
					await this.restoreFiles(files);
					throw error;
				}
				control.phase = "applying";
				announce("applying");
				result.bundle = name;
				if (version !== void 0) result.version = version;
				result.target = name;
				result.stage = "enable";
				return this.configure(async () => {
					if (options?.enabled !== false) await this.selectBundle(name, true);
					if (Object.hasOwn(before, name) && this.ownerContext.get("hmr") === void 0) return;
					const selected = bundleSelection(readProfileManifest("dsh", this.profile.dir)).includes(name);
					Object.assign(result, await this.publishAndReload(selected ? this.bundleRows(name).map((row) => row.id) : []));
				});
			}, {
				stage: "install",
				target: spec,
				enabled: options?.enabled !== false
			}, "install");
			control.result = result;
			return result.finally(() => {
				if (requestId !== void 0) this.installs.delete(requestId);
			});
		}
		/** Recover the result of an active installation without cancelling it. */
		async change(operation, request, reason, identity) {
			const id = randomUUID();
			const target = identity === void 0 ? this.operationTarget(reason, request.target) : identity.target;
			const version = identity === void 0 ? this.operationVersion(reason, reason === "plugin" ? request.target : target) : identity.version;
			const facts = {
				id,
				reason,
				stage: request.stage,
				target,
				...version === void 0 ? {} : { version },
				...request.enabled === void 0 ? {} : { enabled: request.enabled }
			};
			this.reportOperation({
				...facts,
				time: (/* @__PURE__ */ new Date()).toISOString(),
				phase: "started"
			});
			let settled;
			try {
				settled = await withFileLock(join(this.profile.dir, "package.json"), async () => {
					this.abort.signal.throwIfAborted();
					const before = this.diskState();
					const result = {
						...request,
						changed: false,
						...this.ownerContext.get("hmr") !== void 0 ? { application: "applied" } : {
							application: "restart-required",
							restartReason: "no-hmr"
						}
					};
					try {
						const outcome = await operation(result);
						if (outcome !== void 0) result.application = outcome;
						else if (result.application === "applied" && result.restartReason !== void 0) result.application = "restart-required";
					} catch (error) {
						if (error instanceof InstallCancelledError) result.application = "cancelled";
						else {
							result.application = "failed";
							result.error = managementError(error);
						}
					}
					if (result.application !== "restart-required") delete result.restartReason;
					result.changed = before !== this.diskState();
					this.ownerContext.emit("plugin-manager/changed", { reason });
					return result;
				}, { waitMs: this.lockWaitMs });
			} catch (error) {
				this.reportOperation({
					...facts,
					time: (/* @__PURE__ */ new Date()).toISOString(),
					phase: "unknown"
				});
				throw error;
			}
			const refusedVersion = reason === "install" ? settled.error?.incompatible?.find((plugin) => plugin.name === facts.target)?.version : void 0;
			const observedVersion = diagnosticVersion(settled.version ?? refusedVersion);
			this.reportOperation({
				...facts,
				time: (/* @__PURE__ */ new Date()).toISOString(),
				phase: "settled",
				stage: settled.stage,
				target: settled.bundle === void 0 ? facts.target : installOperationTarget(settled.bundle),
				application: settled.application,
				changed: settled.changed,
				...observedVersion === void 0 ? {} : { version: observedVersion },
				...settled.error === void 0 ? {} : { errorCode: settled.error.code },
				...settled.restartReason === void 0 ? {} : { restartReason: settled.restartReason }
			});
			return settled;
		}
}`

export const pluginManagerAlpha3IndexTypes = "export type * from './types.ts';\nexport declare class PluginManager extends TypertRemoteService {\n}\n"
export const pluginManagerAlpha3OptionsTypes = 'export interface InstallBundleOptions {\n}\n'
