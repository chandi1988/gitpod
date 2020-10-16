/**
 * Copyright (c) 2020 TypeFox GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

import { PortConfig, PortVisibility, WorkspaceInstancePort } from '@gitpod/gitpod-protocol';
import type { PortsStatus } from '@gitpod/supervisor-api-grpc/lib/status_pb';
import { Emitter } from '@theia/core/lib/common/event';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { inject, injectable, postConstruct } from 'inversify';
import { GitpodPortServer } from '../../common/gitpod-port-server';

@injectable()
export class GitpodPortsService {

    private readonly deferredReady = new Deferred<void>();
    private readonly _ports = new Map<number, PortsStatus.AsObject>();

    private readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    private readonly onDidServePortEmitter = new Emitter<PortsStatus.AsObject>();
    readonly onDidServePort = this.onDidServePortEmitter.event;

    private readonly onDidExposePortEmitter = new Emitter<PortsStatus.AsObject>();
    readonly onDidExposePort = this.onDidExposePortEmitter.event;

    @inject(GitpodPortServer) private readonly server: GitpodPortServer;

    @postConstruct()
    protected async init(): Promise<void> {
        this.updatePorts(await this.server.getPorts());
        this.server.setClient({
            onDidChange: ({ ports }) => this.updatePorts(ports)
        });
        this.deferredReady.resolve();
    }

    private updatePorts(ports: PortsStatus.AsObject[]): void {
        for (const port of ports) {
            const current = this._ports.get(port.localPort);
            if (port.served && !current?.served) {
                this.onDidServePortEmitter.fire(port);
            }
            if (port.exposed && !current?.exposed) {
                this.onDidExposePortEmitter.fire(port);
            }
            this._ports.set(port.localPort, port);
        }
        this.onDidChangeEmitter.fire();
    }

    async getPort(localPort: number): Promise<PortsStatus.AsObject | undefined> {
        await this.deferredReady.promise;
        return this._ports.get(localPort);
    }

    getPortURL(localPort: number): string | undefined {
        // TODO async?
        const port = this._ports.get(localPort);
        return port?.exposed?.url;
    }

    async openPort(port: PortsStatus.AsObject | PortConfig, visibility?: PortVisibility) {
        let cfg: WorkspaceInstancePort;
        if (PortConfig.is(port)) {
            cfg = port;
            cfg.visibility = visibility || cfg.visibility;
        } else {
            cfg = {
                port: port.localPort,
                targetPort: port.globalPort,
                visibility: visibility
            };
        }

        const pendingExpose = new Promise(resolve => {
            const listener = this.onDidExposePort(exposedPort => {
                if (exposedPort.localPort === cfg.port) {
                    listener.dispose();
                    resolve();
                }
            });
        });
        await this.service.server.openPort(this.workspaceId, cfg);

        await pendingExpose;
    }

}