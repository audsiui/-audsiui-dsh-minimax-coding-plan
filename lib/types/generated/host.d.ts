export declare const TYPERT: {
    package: string;
    face: string;
    schemas: never[];
    invocations: {
        id: string;
        service: string;
        namespace: string;
        method: string;
        invocation: {
            kind: string;
        };
        parameters: never[];
        result: {
            mode: string;
            typeSymbol: string;
            create: () => any;
        };
        sourceLocation: {
            file: string;
            line: number;
            column: number;
        };
    }[];
    model: {
        services: {
            description: string;
            summary: string;
            tags: never[];
            jsDoc: string;
            key: string;
            exportName: string;
            members: {
                kind: string;
                name: string;
                signature: string;
                summary: string;
                jsDoc: string;
            }[];
            types: {
                name: string;
                declaration: string;
            }[];
        }[];
        events: {
            description: string;
            summary: string;
            tags: {
                name: string;
                comment: string;
                text: string;
            }[];
            jsDoc: string;
            name: string;
            mode: string;
            signature: string;
        }[];
        objects: never[];
    };
};
//# sourceMappingURL=host.d.ts.map