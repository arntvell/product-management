import { METAFIELD_NAMESPACE } from "@/lib/constants";

export const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          tags
          status
          featuredImage {
            url
          }
          mediaCount {
            count
          }
          metafields(first: 20, namespace: "${METAFIELD_NAMESPACE}") {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCT_SEARCH_QUERY = `
  query SearchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          vendor
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

export const PAGES_QUERY = `
  query GetPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          bodySummary
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          image {
            url
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAOBJECTS_QUERY = `
  query GetMetaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      edges {
        node {
          id
          handle
          fields {
            key
            value
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const NODES_QUERY = `
  query GetNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage {
        id
        alt
        image {
          url
        }
        preview {
          image {
            url
          }
        }
      }
      ... on GenericFile {
        id
        alt
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

export const PRODUCT_MEDIA_QUERY = `
  query GetProductMedia($id: ID!, $first: Int!) {
    product(id: $id) {
      media(first: $first) {
        edges {
          node {
            ... on MediaImage {
              id
              alt
              mediaContentType
              image {
                url
                width
                height
              }
              preview {
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;
