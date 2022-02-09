<?php

if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

//
// Metabox of the PAGE
// Set a unique slug-like ID
//
$postvideo = 'restly_postmeta_video';

//
// Create a metabox
//
CSF::createMetabox( $postvideo, array(
    'title'        => esc_html('Post Format Video','restly'),
    'post_type'    => array( 'post' ),
    'post_formats' => 'video',
) );

//
// Create a section
//
CSF::createSection( $postvideo, array(
    'title'  => esc_html__( 'Add Video Link ', 'restly' ),
    'icon'   => 'fas fa-rocket',
    'fields' => array(
        array(
            'id'       => 'restly_post_video',
            'type'     => 'text',
            'title'    => esc_html__( 'Video Link', 'restly' ),
            'subtitle' => esc_html__( 'Add Post Video Link here', 'restly' ),
            'default'  => 'https://www.youtube.com/watch?v=qhwG7h5gLDU'
        ),
       
    ),
) );