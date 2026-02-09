export const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE_MUTATION = `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_CREATE_MUTATION = `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_UPDATE_MUTATION = `
  mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_DELETE_MUTATION = `
  mutation MetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_CREATE_MUTATION = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const PRODUCT_CREATE_MEDIA_MUTATION = `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          alt
          mediaContentType
          preview {
            image {
              url
            }
          }
        }
      }
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

export const PRODUCT_DELETE_MEDIA_MUTATION = `
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

export const PRODUCT_REORDER_MEDIA_MUTATION = `
  mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job {
        id
      }
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;
