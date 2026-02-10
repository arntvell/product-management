export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: {
      code: string;
      cost?: {
        requestedQueryCost: number;
        actualQueryCost: number;
        throttleStatus: {
          maximumAvailable: number;
          currentlyAvailable: number;
          restoreRate: number;
        };
      };
    };
  }>;
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export interface ProductsQueryResult {
  products: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        vendor: string;
        productType: string;
        tags: string[];
        status: string;
        featuredImage: {
          url: string;
        } | null;
        mediaCount?: {
          count: number;
        };
        metafields: {
          edges: Array<{
            node: {
              namespace: string;
              key: string;
              value: string;
              type: string;
            };
          }>;
        };
      };
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface PagesQueryResult {
  pages: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        bodySummary: string;
      };
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface CollectionsQueryResult {
  collections: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        image: { url: string } | null;
      };
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface MetaobjectsQueryResult {
  metaobjects: {
    edges: Array<{
      node: {
        id: string;
        handle: string;
        fields: Array<{ key: string; value: string }>;
      };
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface ProductMediaQueryResult {
  product: {
    media: {
      edges: Array<{
        node: {
          id: string;
          alt: string;
          mediaContentType: string;
          image?: { url: string; width: number; height: number };
          preview?: { image?: { url: string } };
        };
      }>;
    };
  };
}

export interface MetaobjectMutationResult {
  metaobjectCreate?: {
    metaobject: { id: string; handle: string } | null;
    userErrors: Array<{ field: string[]; message: string; code: string }>;
  };
  metaobjectUpdate?: {
    metaobject: { id: string; handle: string } | null;
    userErrors: Array<{ field: string[]; message: string; code: string }>;
  };
  metaobjectDelete?: {
    deletedId: string | null;
    userErrors: Array<{ field: string[]; message: string; code: string }>;
  };
}

export interface StagedUploadsCreateResult {
  stagedUploadsCreate: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{ name: string; value: string }>;
    }>;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

export interface ProductCreateMediaResult {
  productCreateMedia: {
    media: Array<{
      id: string;
      alt: string;
      mediaContentType: string;
      preview?: { image?: { url: string } };
    }> | null;
    mediaUserErrors: Array<{ field: string[]; message: string; code: string }>;
  };
}

export interface ProductDeleteMediaResult {
  productDeleteMedia: {
    deletedMediaIds: string[];
    mediaUserErrors: Array<{ field: string[]; message: string; code: string }>;
  };
}

export interface ProductReorderMediaResult {
  productReorderMedia: {
    job: { id: string } | null;
    mediaUserErrors: Array<{ field: string[]; message: string; code: string }>;
  };
}

export interface FileCreateResult {
  fileCreate: {
    files: Array<{ id: string; alt: string }> | null;
    userErrors: Array<{ field: string[]; message: string; code: string }>;
  };
}

export interface NodesQueryResult {
  nodes: Array<{
    id: string;
    alt?: string;
    image?: { url: string };
    preview?: { image?: { url: string } };
  } | null>;
}

export interface MetafieldsDeleteResult {
  metafieldsDelete: {
    deletedMetafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
    }> | null;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

export interface MetafieldsSetResult {
  metafieldsSet: {
    metafields: Array<{
      id: string;
      namespace: string;
      key: string;
      value: string;
    }> | null;
    userErrors: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}
